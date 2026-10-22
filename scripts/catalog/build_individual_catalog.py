"""Build a bounded, read-only search index for individual public 3D models.

The deployed Worker reads fixed same-origin asset keys. No database, runtime
ingestion, source downloads, or bucket enumeration is needed for catalog reads.
"""

import array
import base64
import csv
import gzip
import hashlib
import json
import re
import shutil
import unicodedata
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

from .scene_datasets import scene_records, named_variant_groups, MAX_SCENE_FILE_LINKS
from .scene_qualification import apply_calibration_review, launch_manifest_asset, native_launch_manifest, native_evidence, native_scene_reviews, public_launch_manifest, qualified_evidence, scene_key, verified_scene_reviews, verified_source_entry
from .scene_photos import apply_photo_evidence, photo_scene_reviews
from .scene_contents import apply_content_evidence, apply_thumbnail_evidence, content_scene_reviews
from .scene_manifests import apply_manifest_evidence, manifest_assets, manifest_scene_reviews
from .photo_routing import apply_routing, routing_asset, routing_coverage, routing_failures, routing_reviews
from .archive_routing import archive_reviews, archive_asset, apply_archive_routing
from .photo_decisions import decision_records, decision_coverage
from .scene_discovery import HISTORY, load_history, discovery_row

# A normal results page must not parse thousands of unrelated scene records.
# Keeping packs at page size also bounds filtered searches spanning many packs.
PACK_SIZE = 24
FORMATS = {'colmap': 'COLMAP', 'cameras': 'COLMAP cameras and poses', 'ply': 'PLY (header unchecked)',
           'spz': 'SPZ (header unchecked)', 'sog': 'SOG (header unchecked)', 'splat': 'SPLAT (header unchecked)',
           'ksplat': 'KSPLAT (header unchecked)', 'splat-scene': 'Gaussian components (headers unchecked)', 'camera-metadata': 'Camera metadata',
           'camera-scene': 'Camera metadata and scene assets'}
AUDIT_FORMATS = {'colmap': 'COLMAP', 'point_cloud_ply': 'XYZ point-cloud PLY', 'gaussian_ply': 'Gaussian PLY',
                 'spz': 'SPZ', 'spz_v4': 'SPZ version 4', 'sog': 'SOG', 'zstd_wrapped_splat': 'Zstandard-compressed splat'}
KIND_LABELS = {'colmap': 'COLMAP reconstruction', 'cameras': 'Cameras and poses', 'ply': 'PLY model',
               'spz': 'Gaussian splat', 'sog': 'Gaussian splat', 'splat': 'Gaussian splat', 'ksplat': 'Gaussian splat',
               'camera-metadata': 'Camera metadata', 'camera-scene': 'Camera dataset', 'splat-scene': 'Gaussian scene', 'scene': 'Public scene'}
FAILED_DELIVERY = {'gated', 'access_denied', 'not_found', 'browser_request_failed', 'range_unverified', 'rate_limited', 'http_error'}


def can_open_scene(entry, row, proof):
    """Camera/model compatibility is independent of photographs and export checks."""
    kind, _, _, archive = row
    proof = proof or {}
    if (entry.get('status') == 'unsupported_content' or entry.get('access') != 'public' or archive
            or proof.get('opening') or proof.get('delivery') in FAILED_DELIVERY
            or proof.get('level') in {'conversion_needed', 'no_native_assets', 'unavailable'}):
        return False
    if proof.get('sampleScope') == 'companion_asset':
        return False
    compatibility = proof.get('sceneCompatibility') or {}
    if (kind in ('colmap', 'cameras') and proof.get('level') == 'native_layout_checked' and proof.get('viewerUrl')
            and proof.get('delivery') in {'browser_readable', 'cors_headers_checked'}
            and compatibility.get('status') == 'native_headers_checked'
            and all(value is None or type(value) is int and value > 0
                    for value in (compatibility.get('cameras'), compatibility.get('images')))
            and compatibility.get('cameraRecordChecked') is True and compatibility.get('poseRecordChecked') is True):
        return kind != 'cameras' or compatibility.get('points') == 0
    validation = proof.get('sceneValidation') or {}
    return (kind in {'colmap', 'cameras', 'camera-scene', 'scene'} and proof.get('level') == 'scene_verified'
            and proof.get('delivery') == 'browser_readable' and bool(proof.get('viewerUrl'))
            and validation.get('status') == 'passed' and validation.get('export') in ('colmap_images', 'colmap_model')
            and type(validation.get('cameras')) is int and validation['cameras'] > 0
            and type(validation.get('images')) is int and validation['images'] > 0)


def reviewed_scene_exclusions(catalog, policy):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('reviews'), list):
        raise ValueError('Invalid scene publication reviews')
    entries = {entry['sourceId']: entry for entry in catalog['entries']}
    excluded = set()
    for review in policy['reviews']:
        entry = entries.get(review['sourceId'])
        revision = next((fact['value'] for fact in (entry or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if not entry or revision != review.get('revision'):
            raise ValueError(f'Scene exclusion revision changed; recheck {review["sourceId"]}')
        if not review.get('reason') or not review.get('summary') or not review.get('scenes'):
            raise ValueError('Scene exclusions require a reason and exact scene paths')
        for scene in review['scenes']:
            key = (review['sourceId'], scene['kind'], scene['path'], scene.get('archive'))
            if key in excluded:
                raise ValueError('Duplicate scene exclusion')
            excluded.add(key)
    return excluded


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


def is_access_restricted(entry):
    """Same policy as catalog-publication.mjs; shared fixtures cover both builds."""
    proof = entry.get('verification') or {}
    return (entry.get('access') == 'gated' or bool(entry.get('gated')) or entry.get('delivery') == 'gated'
            or proof.get('delivery') == 'gated' or (proof.get('opening') or {}).get('status') == 'access_required')


def encoded(values):
    result, previous = bytearray(), 0
    for value in values:
        delta, previous = value - previous, value
        while delta >= 128:
            result.append((delta & 127) | 128)
            delta >>= 7
        result.append(delta)
    return base64.b64encode(result).decode('ascii')


def tokens(text):
    normalized = ''.join(char for char in unicodedata.normalize('NFKD', text) if not unicodedata.combining(char)).lower()
    return set(re.findall(r'[^\W_]+', normalized))


def label(entry):
    return entry.get('datasetLabel') or next((fact['value'] for fact in entry['facts'] if fact['label'] == 'Collection'), entry['title'].split('/')[-1])


def identity(source_id, row):
    kind, path, _, archive = row
    return 'data-' + hashlib.sha256('\0'.join([source_id, kind, archive or '', path]).encode()).hexdigest()[:24]


def retained_scene_selection(row, selection, review, inventory):
    """Keep a checked selection explicit when discovery adds other scene anchors."""
    if (not review or selection.get('files') != review['files']
            or selection.get('exportSha256') != review['exportSha256']
            or any(selection.get(key) != value for key, value in zip(('kind', 'path', 'archive'), (row[0], row[1], row[3])))):
        raise ValueError('Retained scene selection lacks its exact export receipt')
    files = selection['files']
    physical = {path for item in inventory if item[3] == row[3]
                for path in [item[1], *(item[2] or {}).values()]}
    if (not files or any(path not in physical for path in files.values())
            or any((row[2] or {}).get(role) != files.get(role) for role in ('cameras', 'images', 'points3d'))
            or row[0] == 'camera-scene' and review.get('loadPath') not in (row[2] or {}).values()):
        raise ValueError('Retained scene selection changed its model or lost source files')
    return [row[0], row[1], dict(files), row[3]]


def hf_url(entry, revision, path, tree=False):
    repo = urllib.parse.quote(entry['sourceId'][3:], safe='/')
    return f'https://huggingface.co/datasets/{repo}/{"tree" if tree else "resolve"}/{revision}' + ('/' + urllib.parse.quote(path, safe='/') if path else '')


def item_evidence(entry, row, revision, result):
    """Proof follows the exact sampled path; it is never copied to siblings."""
    kind, path, files, archive = row
    candidate = hf_url(entry, revision, archive or path, tree=kind in ('colmap', 'cameras') and not archive)
    matched = False
    archive_probe = None
    member_probe = None
    if archive:
        archive_probe = next((probe for probe in result.get('probes', []) if probe.get('url') == candidate), None)
        if archive_probe:
            member_probe = next((probe for probe in archive_probe.get('probes', []) if probe.get('path') == path and probe.get('format')), None)
            matched = archive_probe.get('modelDirectory') == path or member_probe is not None
    elif kind in ('colmap', 'cameras'):
        matched = result.get('modelDirectory') == path and result.get('revision') == revision
    else:
        matched = candidate == result.get('loadUrl') or any(probe.get('url') == candidate and probe.get('format')
                                                           for probe in result.get('probes', []))
    companion_sample = False
    metadata_sample = False
    if not matched and not archive and kind in ('colmap', 'cameras', 'camera-scene', 'splat-scene'):
        for role, value in (files or {}).items():
            if role.startswith('asset:') and hf_url(entry, revision, value) == result.get('loadUrl'):
                candidate = result['loadUrl']
                companion_sample = matched = True
                break
    if not matched and not archive and kind == 'camera-scene':
        for role, value in (files or {}).items():
            if role.startswith('metadata:') and hf_url(entry, revision, value) == result.get('loadUrl'):
                candidate = result['loadUrl']
                metadata_sample = matched = True
                break
    if not matched or entry['status'] == 'unsupported_content':
        return None, FORMATS.get(kind, '.' + kind)
    proof = dict(entry.get('verification', {}))
    # Source-level opening restrictions and viewer links are not individual proof.
    proof.pop('opening', None)
    proof.pop('viewerUrl', None)
    proof['statusLabel'] = entry['statusLabel']
    imported = result.get('viewerImport', {})
    proof['scope'] = 'This recorded model or file only. Other collection entries, source photos, and masks have separate evidence.'
    matching_probe = member_probe or archive_probe or next((probe for probe in result.get('probes', []) if probe.get('url') == candidate), {})
    format_name = AUDIT_FORMATS.get(matching_probe.get('format'), FORMATS.get(kind, '.' + kind))
    if companion_sample:
        proof['sampleScope'] = 'companion_asset'
        proof['scope'] = 'Only the linked companion model file was checked. The scene cameras, reconstruction, remaining assets, source photos, and masks need their own checks.'
        format_name = FORMATS.get(kind, 'Scene assets listed') + ' · ' + format_name
    elif metadata_sample:
        proof['scope'] = 'Only the linked camera metadata file was checked. The remaining scene assets, source photos and masks need their own checks.'
    elif kind == 'colmap':
        format_name = 'COLMAP'
    required = [candidate]
    if kind == 'colmap' and not archive and not companion_sample:
        required = [hf_url(entry, revision, value) for role, value in (files or {}).items() if role in ('cameras', 'images', 'points3d')]
    browser = {check['url']: check for check in result.get('browserChecks', [])}
    if required and all(browser.get(url, {}).get('delivery') == 'browser_readable' for url in required):
        proof['delivery'] = 'browser_readable'
    elif any(url in browser and browser[url].get('delivery') != 'browser_readable' for url in required):
        proof['delivery'] = next(browser[url]['delivery'] for url in required if url in browser and browser[url].get('delivery') != 'browser_readable')
    else:
        proof['delivery'] = 'gated' if entry.get('access') == 'gated' else 'server_readable'
    original_import = imported.get('sourceUrl') == candidate
    unsupported = matching_probe.get('format') in ('spz_v4', 'zstd_wrapped_splat', 'geometry_conversion', 'camera_metadata')
    if unsupported:
        proof['level'] = 'conversion_needed'
        proof['statusLabel'] = 'Conversion needed'
        proof['summary'] = f'{format_name} needs conversion or a compatible importer in the released viewer.'
    elif imported and not original_import or candidate != result.get('loadUrl'):
        proof['level'] = 'header_checked'
        proof['statusLabel'] = 'Format headers checked'
        proof['summary'] = f'{format_name} identified from this model’s original header. Complete loading and rendering remain unverified.'
    elif original_import and imported.get('status') == 'passed':
        proof['summary'] = f'{format_name} sample opened in ColmapView {proof.get("viewerVersion", "the released viewer")}. Other assets, photos and masks remain unverified.'
        if companion_sample:
            proof['statusLabel'] = 'Companion asset opened; scene unverified'
            proof['summary'] = 'The linked companion asset opened in the viewer. Scene cameras, original photos, masks and complete-scene export remain unverified.'
    if entry.get('access') == 'gated' or proof['delivery'] == 'gated':
        proof['delivery'] = 'gated'
        proof['statusLabel'] = 'Access required'
        proof['opening'] = {'status': 'access_required', 'summary': 'Obtain access and download the original file on Hugging Face before attempting local import. Direct gated loading is not qualified.'}
    elif archive:
        proof['opening'] = {'status': 'extraction_required', 'summary': 'Extract this exact model or file from its archive before attempting to load it. Archive byte access does not establish a working direct model link.'}
        member_import = result.get('extractedMemberImport', {})
        if member_import.get('path') == path and member_import.get('status') == 'passed' and member_import.get('sourceUrl') == candidate:
            proof['statusLabel'] = 'Extracted file opened; extraction required'
            proof['summary'] = 'This original extracted member imported in the released viewer through a controlled same-origin response. Direct archive loading, source cameras, photos and masks are not qualified by that check.'
        elif not unsupported:
            proof['statusLabel'] = 'Member headers checked; extraction required'
            proof['summary'] = f'{format_name} identified at this exact path inside the archive. Extract it before attempting import; complete loading remains unverified.'
    elif original_import and imported.get('status') == 'failed':
        proof['opening'] = {'status': 'load_failed', 'summary': 'This exact sampled file failed in the released viewer. See its retained decoder or import error.'}
    if entry.get('viewerUrl') and entry.get('access') != 'gated' and not proof.get('opening') and proof['delivery'] == 'browser_readable' and candidate.rstrip('/') == result.get('loadUrl', '').rstrip('/') and not archive and not unsupported and not companion_sample:
        proof['viewerUrl'] = entry['viewerUrl']
    return proof, format_name


def build(root=Path('.')):
    history_path = root / HISTORY
    history_bytes = history_path.read_bytes() if history_path.exists() else b''
    history = load_history(history_bytes)['firstSeen']
    catalog = read(root / 'data/catalog.json')
    registry_bytes = (root / 'data/individual-datasets.json').read_bytes()
    registry = json.loads(registry_bytes)
    audit = {row['sourceId']: row for row in read(root / 'data/dataset-audit.json')['results']}
    policy_bytes = (root / 'data/scene-exclusions.json').read_bytes()
    scene_exclusions = reviewed_scene_exclusions(catalog, json.loads(policy_bytes))
    verified_bytes = (root / 'data/verified-scenes.json').read_bytes()
    verified_scenes = verified_scene_reviews(catalog, json.loads(verified_bytes))
    native_bytes = (root / 'data/native-layouts.json.gz').read_bytes()
    native_policy = json.loads(gzip.decompress(native_bytes))
    native_scenes = native_scene_reviews(catalog, native_policy)
    photo_bytes = (root / 'data/scene-photos.json.gz').read_bytes()
    photo_policy = json.loads(gzip.decompress(photo_bytes))
    photo_reviews = photo_scene_reviews(catalog, photo_policy)
    content_bytes = (root / 'data/scene-contents.json.gz').read_bytes()
    content_policy = json.loads(gzip.decompress(content_bytes))
    content_reviews = content_scene_reviews(catalog, content_policy, root)
    checked_photo_previews = {}
    for key, review in content_reviews.items():
        thumbnail = review.get('thumbnail')
        if thumbnail and not thumbnail.get('sourceArchive'):
            checked_photo_previews[(key[0], review['revision'], thumbnail['sourcePath'], thumbnail['sourceSha256'])] = thumbnail
    manifest_bytes = (root / 'data/scene-manifests.json').read_bytes()
    manifest_policy = json.loads(manifest_bytes)
    manifest_reviews = manifest_scene_reviews(catalog, manifest_policy)
    routing_bytes = (root / 'data/photo-routing.json.gz').read_bytes()
    routing_policy = json.loads(gzip.decompress(routing_bytes))
    archive_bytes = (root / 'data/companion-media-routing.json.gz').read_bytes()
    archive_policy = json.loads(gzip.decompress(archive_bytes))
    photo_archives = archive_reviews(catalog, archive_policy)
    decision_bytes = (root / 'data/photo-audit-decisions.json.gz').read_bytes()
    decision_policy = json.loads(gzip.decompress(decision_bytes))
    photo_decisions = decision_records(decision_policy)
    photo_routing = routing_reviews(catalog, routing_policy)
    unresolved_routing = routing_failures(catalog, routing_policy)
    if set(photo_routing) & set(unresolved_routing):
        raise ValueError('A scene cannot have both checked and unresolved photo routing')
    matched_routing = set()
    matched_archives = set()
    if set(photo_archives) & set(photo_routing):
        raise ValueError('A photo inventory and archive cannot replace the same scene launch')
    matched_unresolved = set()
    matched_manifests = set()
    generated_manifests = {}
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    for review in manifest_reviews.values():
        generated_manifests.update(manifest_assets(review, parents[review['sourceId']], hf_url))
    for review in photo_routing.values():
        name, body = routing_asset(review, parents[review['sourceId']], hf_url)
        generated_manifests[name] = body
    for review in photo_archives.values():
        name, body = archive_asset(review, parents[review['sourceId']], hf_url)
        generated_manifests[name] = body
    for review in native_scenes.values():
        manifest = native_launch_manifest(parents[review['sourceId']], review, hf_url)
        if manifest:
            name, body = launch_manifest_asset(manifest)
            generated_manifests[name] = body
    for review in verified_scenes.values():
        manifest = public_launch_manifest(review) if parents[review['sourceId']]['provider'] == 'public' else None
        if manifest:
            name, body = launch_manifest_asset(manifest)
            generated_manifests[name] = body
    matched_contents = set()
    matched_photos = set()
    matched_reviews = set()
    matched_native = set()
    published_reviews = []
    excluded = {row['sourceId'] for row in [*catalog['entries'], *audit.values()] if is_access_restricted(row)}
    generation = hashlib.sha256((root / 'data/catalog.json').read_bytes() + registry_bytes
                                + (root / 'data/dataset-audit.json').read_bytes() + policy_bytes + verified_bytes + native_bytes + photo_bytes + content_bytes + manifest_bytes + routing_bytes + Path(__file__).read_bytes()
                                + Path(__file__).with_name('scene_qualification.py').read_bytes()
                                + Path(__file__).with_name('scene_photos.py').read_bytes()
                                + Path(__file__).with_name('scene_contents.py').read_bytes()
                                + Path(__file__).with_name('scene_datasets.py').read_bytes()
                                + Path(__file__).with_name('scene_manifests.py').read_bytes()
                                + Path(__file__).with_name('photo_routing.py').read_bytes()
                                + archive_bytes + decision_bytes
                                + Path(__file__).with_name('archive_routing.py').read_bytes()
                                + Path(__file__).with_name('photo_decisions.py').read_bytes()
                                + Path(__file__).with_name('individual-listings.mjs').read_bytes()
                                + Path(__file__).with_name('catalog-publication.mjs').read_bytes()
                                + (Path(__file__).parent.parent / 'build/catalog.mjs').read_bytes()
                                + history_bytes + Path(__file__).with_name('scene_discovery.py').read_bytes()).hexdigest()
    output = root / 'public/hub/datasets/individual'
    if (output / 'manifests').is_symlink():
        raise ValueError('Manifest output must be a regular generated directory')
    current = output / 'index.json'
    preview_files = {review['thumbnail']['file'] for review in content_reviews.values() if review.get('thumbnail')}
    if (current.exists() and read(current).get('generation') == generation
            and (output / 'feed.json').is_file() and read(output / 'feed.json').get('generation') == generation
            and all((output / 'thumbnails' / name).is_file()
                    and hashlib.sha256((output / 'thumbnails' / name).read_bytes()).hexdigest() + '.jpg' == name for name in preview_files)
            and all((output / 'manifests' / name).is_file() and not (output / 'manifests' / name).is_symlink()
                    and (output / 'manifests' / name).read_bytes() == body
                    for name, body in generated_manifests.items())):
        print('Individual metadata index is current.', flush=True)
        return
    output.mkdir(parents=True, exist_ok=True)
    manifest_output = output / 'manifests'
    manifest_output.mkdir(exist_ok=True)
    # Retain immutable old manifests so previously shared public links still resolve.
    for name, body in generated_manifests.items():
        path = manifest_output / name
        if path.is_symlink():
            raise ValueError('Manifest asset must be a regular generated file')
        path.write_bytes(body)
    for name in ['packs', 'ids', 'variants', 'tokens', 'facets', 'sources']:
        directory = output / name
        directory.mkdir(exist_ok=True)
        # Fixed generated directories, immediate generated files only. No recursive
        # deletes, source mutation, symlink traversal, or dataset downloads.
        for path in directory.iterdir():
            if path.is_file() and not path.is_symlink() and path.suffix == '.json':
                path.unlink()

    def write(name, value):
        raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError(f'Index asset exceeds the bounded reader: {name}')
        (output / name).write_bytes(raw)

    by_dataset = {row['datasetId']: row for row in registry['sources']}
    postings, facets = {}, defaultdict(dict)
    ids = defaultdict(dict)
    retained_variants = defaultdict(dict)
    grouped_variants = 0
    sources, pack, total = [], [], 0
    counts, levels, deliveries = Counter(), Counter(), Counter()
    photos = Counter()
    contents = Counter()
    thumbnails = set()
    thumbnail_scenes = 0
    discovery = []
    photo_rows = []
    routing_counts = Counter()
    decision_counts = Counter()

    def add_posting(mapping, key, ordinal):
        if key not in mapping:
            mapping[key] = array.array('I')
        mapping[key].append(ordinal)

    for entry_number, entry in enumerate(catalog['entries']):
        if entry['sourceId'] in excluded:
            continue
        source_index = len(sources)
        dataset_label = label(entry)
        registered = by_dataset.get(entry['id'])
        result = audit.get(entry['sourceId'], {})
        complete = True
        revision = None
        scene_details = {}
        source_proofs, source_formats = [], []
        retained_selections = {}
        if registered:
            if registered['file'] != entry['id'] + '.json.gz':
                raise ValueError('Individual listing file does not match its dataset identity')
            path = root / 'data/individual-datasets' / registered['file']
            if hashlib.sha256(path.read_bytes()).hexdigest() != registered['sha256']:
                raise ValueError(f'Individual source checksum changed: {entry["sourceId"]}')
            listing = read(path)
            revision = next((fact['value'] for fact in entry['facts'] if fact['label'] == 'Pinned revision'), None)
            if listing['datasetId'] != entry['id'] or listing['sourceId'] != entry['sourceId'] or len(listing['items']) != registered['count']:
                raise ValueError('Individual listing identity or record count changed')
            if listing['revision'] != revision:
                raise ValueError(f'Individual listing revision changed: {entry["sourceId"]}')
            rows = scene_records(listing['items'], scene_details,
                                 result.get('sceneRootAliases') if result.get('revision') == revision else None)
            for selected in listing.get('sceneSelections', []):
                key = scene_key(entry['sourceId'], selected['kind'], selected['path'], selected.get('archive'))
                if key in retained_selections:
                    raise ValueError('Duplicate retained scene selection')
                retained_selections[key] = selected
            complete = listing['listingComplete']
        elif entry['provider'] == 'public' and any(fact['label'] == 'Collection' for fact in entry['facts']):
            # Existing public entries already identify a scene/subset/variant.
            # Retain that identity rather than treating the whole provider as one model.
            review = verified_scenes.get(scene_key(entry['sourceId'], 'scene', entry['title']))
            revision = next((fact['value'] for fact in entry['facts'] if fact['label'] == 'Pinned revision'), None)
            rows = [['scene', entry['title'], review['files'] if review else None, None]]
        else:
            continue
        source = {'id': entry['id'], 'sourceId': entry['sourceId'], 'title': entry['title'], 'label': dataset_label,
                  'sourceUrl': entry['sourceUrl'],
                  'provider': entry['provider'], 'license': entry['license'],
                  **({'licenseCategory': entry['licenseCategory']} if 'licenseCategory' in entry else {}), 'access': entry['access'],
                  'start': total, 'count': 0, 'listingComplete': complete}
        qualified = []
        for row in rows:
            kind, path, files, archive = row
            review_key = scene_key(entry['sourceId'], kind, path, archive)
            review = verified_scenes.get(review_key)
            native = native_scenes.get(review_key)
            if review_key in retained_selections:
                detail = scene_details[(kind, path, archive)]
                if detail['linksTruncated']:
                    raise ValueError('Retained scene selection needs an exact untruncated asset inventory')
                discovered_files = set((row[2] or {}).values())
                row = retained_scene_selection(row, retained_selections.pop(review_key), review, listing['items'])
                files = row[2]
                listed = len(discovered_files | set(files.values()))
                detail.update(listedAssets=listed, linkedAssets=len(files), linksTruncated=listed > len(files))
            if not review and not native:
                continue
            if native:
                matched_native.add(review_key)
                proof, format_name = native_evidence(entry, row, revision, native, hf_url)
            if review:
                matched_reviews.add(review_key)
                proof, format_name = qualified_evidence(entry, row, revision, review, hf_url)
            if not can_open_scene(entry, row, proof) or (entry['sourceId'], kind, path, archive) in scene_exclusions:
                continue
            photo_review = photo_reviews.get(review_key)
            if photo_review:
                proof = apply_photo_evidence(entry, row, revision, proof, photo_review)
                matched_photos.add(review_key)
            elif photo_policy['coverage'] == 'all_published_scenes':
                raise ValueError('Published scene is missing pinned photo evidence; recheck its availability')
            content_review = content_reviews.get(review_key)
            if not content_review:
                raise ValueError('Published scene is missing pinned content evidence')
            proof = apply_content_evidence(entry, row, revision, proof, content_review)
            matched_contents.add(review_key)
            routing_review = photo_routing.get(review_key)
            if routing_review:
                proof = apply_routing(entry, row, revision, proof, routing_review, hf_url)
                matched_routing.add(review_key)
            # A complete scene selection supersedes the older photo-only launch,
            # while retaining that original routing receipt as historical evidence.
            manifest_review = manifest_reviews.get(review_key)
            if manifest_review:
                proof, format_name = apply_manifest_evidence(entry, row, revision, proof, manifest_review, hf_url)
                matched_manifests.add(review_key)
                if not proof.get('thumbnail') and manifest_review['photos']:
                    first_photo = manifest_review['photos'][0]
                    thumbnail = checked_photo_previews.get((entry['sourceId'], revision, first_photo['sourcePath'], first_photo['sha256']))
                    if thumbnail:
                        proof = apply_thumbnail_evidence(entry, proof, thumbnail)
            if review_key in photo_archives:
                proof = apply_archive_routing(entry, row, revision, proof, photo_archives[review_key], hf_url)
                matched_archives.add(review_key)
            if review_key in unresolved_routing:
                unresolved = unresolved_routing[review_key]
                if files != unresolved['files'] or proof.get('viewerUrl') != unresolved['sourceViewerUrl']:
                    raise ValueError('Unresolved photo routing belongs to a different model selection')
                proof['photoAudit']['policyNote'] = (proof['photoAudit'].get('policyNote', '')
                    + f" Photo-manifest audit ({routing_policy['checkedAt']}, viewer {routing_policy['viewerVersion']}): {unresolved['reason']}. The existing model launch is retained.")
                matched_unresolved.add(review_key)
            if native and native.get('calibrationReview'):
                proof = apply_calibration_review(proof, native['calibrationReview'])
            qualified.append((row, proof, format_name, review, review_key))
        if retained_selections:
            raise ValueError('Retained scene selection is absent from its pinned source inventory')
        variants = named_variant_groups([item[0] for item in qualified])
        for row, proof, format_name, review, review_key in qualified:
            kind, path, files, archive = row
            item_id = identity(entry['sourceId'], row)
            group = variants.get((kind, path, archive))
            if group:
                primary, scene_title, members = group
                if row is not primary:
                    retained_variants[item_id[5:7]][item_id] = [item_id, source_index, kind, path, format_name, archive, files, proof]
                    if proof.get('thumbnail'):
                        thumbnails.add(proof['thumbnail']['url'].split('/')[-1])
                    grouped_variants += 1
                    continue
                # The card opens the refined selection. Original variants keep
                # their own proofs and URLs and remain addressable by old IDs.
                files = dict(files or {})
                for member in members:
                    if member is not primary:
                        for role, value in (member[2] or {}).items():
                            if value not in files.values() and len(files) < MAX_SCENE_FILE_LINKS:
                                files['variant:' + member[1] + ':' + role] = value
                proof = {**proof, 'sceneTitle': scene_title}
            contents.update(proof['availableData'].keys())
            if proof.get('thumbnail'):
                thumbnails.add(proof['thumbnail']['url'].split('/')[-1])
                thumbnail_scenes += 1
            source_proofs.append(proof)
            source_formats.append(format_name)
            if review:
                published_reviews.append(review)
            if not source['count']:
                sources.append(source)
            source['count'] += 1
            if item_id in ids[item_id[-24:-22]]:
                raise ValueError('Duplicate individual model identity')
            ids[item_id[-24:-22]][item_id] = total
            gated = entry['access'] == 'gated' or bool(proof and proof.get('delivery') == 'gated')
            level = 'Access required' if gated else proof.get('statusLabel', 'Files listed; load not checked') if proof else 'Extraction required; load unverified' if archive else 'Files listed; load not checked'
            delivery = 'gated' if gated else proof.get('delivery', 'not_tested') if proof else 'not_tested'
            item = [item_id, source_index, kind, path, format_name, archive, files, proof]
            discovery.append(discovery_row(proof, history.get(item_id)))
            for component in proof['availableData']:
                add_posting(facets['data'], component, total)
            if kind != 'scene' and (kind, path, archive) in scene_details:
                item.append({**scene_details[(kind, path, archive)], 'listedAssets': len(set(files.values())),
                             'linkedAssets': len(files), 'linksTruncated': False} if group else scene_details[(kind, path, archive)])
            pack.append(item)
            selected_kind = ('splat-scene' if proof.get('sceneManifest', {}).get('frameGeometry', {}).get('role') == 'splat'
                             else 'colmap' if kind == 'cameras' and proof.get('sceneManifest', {}).get('counts', {}).get('points', 0) > 0 else kind)
            kind_name = 'Gaussian splat' if kind == 'ply' and format_name == 'Gaussian PLY' else KIND_LABELS.get(selected_kind, '3D geometry')
            counts[kind_name] += 1
            levels[level] += 1
            deliveries[delivery] += 1
            photo_status = proof.get('photoAvailability', 'not_checked')
            photos[photo_status] += 1
            if photo_status in ('complete_export_checked', 'sample_checked', 'partial'):
                add_posting(facets['photos'], 'available', total)
            photo_audit = proof.get('photoAudit', {})
            photo_rows.append({'id': item_id, 'source': entry['sourceId'], 'scene': path, 'revision': revision,
                'photos': photo_status, 'policy': photo_audit.get('policy', ''), 'modelScope': photo_audit.get('sceneRoot', ''),
                'mediaScope': photo_audit.get('mediaScope', ''), 'photoCollection': photo_audit.get('photoCollection', ''),
                'mappingFile': photo_audit.get('mappingFile', ''), 'companionArchive': photo_audit.get('archive', {}).get('path', ''),
                'samplePhoto': photo_audit.get('samplePath', ''), 'registeredNamesChecked': photo_audit.get('nameCheck', {}).get('registered', ''),
                'matchedPhotoNames': photo_audit.get('nameCheck', {}).get('matched', ''), 'checkedAt': photo_audit.get('checkedAt', ''),
                'notes': photo_audit.get('summary', '') + ' ' + photo_audit.get('policyNote', ''),
                'associationFile': photo_audit.get('associationFile', ''),
                **routing_coverage(proof, kind, unresolved_routing.get(review_key, {}).get('reason', '')),
                **decision_coverage(photo_decisions, entry['sourceId'], revision, kind, path, files)})
            routing_counts[photo_rows[-1]['launchRouting']] += 1
            decision_counts[photo_rows[-1]['auditDecision']] += 1
            for field, value in [('kind', kind_name), ('status', level), ('delivery', delivery), ('photos', photo_status),
                                 ('viewer', 'available' if proof and proof.get('viewerUrl') and not gated and not archive and not proof.get('opening') else '')]:
                add_posting(facets[field], value, total)
            for token in sorted(tokens(' '.join([path, dataset_label, entry['title'], entry['license'], format_name, kind_name]))):
                add_posting(postings, token, total)
            total += 1
            if len(pack) == PACK_SIZE:
                write(f'packs/{(total - 1) // PACK_SIZE}.json', pack)
                pack = []
        if source['count']:
            source_entry = {**verified_source_entry(entry, source_proofs, source_formats), 'facts': [({**fact, 'label': 'Listed 3D assets and model file sets'} if fact['label'] == 'Individual model or scene entries listed' else fact)
                                              for fact in entry['facts']] + [{'label': 'Published scene entries', 'value': str(source['count'])}]}
            source_entry['availableData'] = {}
            for proof in source_proofs:
                for kind, evidence in proof['availableData'].items():
                    if kind not in source_entry['availableData'] or evidence['status'] == 'checked':
                        source_entry['availableData'][kind] = {'status': evidence['status']}
            thumbnail = next((proof['thumbnail'] for proof in source_proofs if proof.get('thumbnail')), None)
            if thumbnail:
                source_entry['thumbnail'] = thumbnail
            write(f'sources/{entry["id"]}.json', source_entry)
        if entry_number % 100 == 0:
            print(f'Indexed {entry_number + 1}/{len(catalog["entries"])} source entries; {total:,} individual records', flush=True)
    if pack:
        write(f'packs/{(total - 1) // PACK_SIZE}.json', pack)
    if any(key not in matched_reviews and key[0] not in excluded for key in verified_scenes):
        raise ValueError('Verified scene no longer matches the scene listing; recheck its identity and file paths')
    if any(key not in matched_native and key[0] not in excluded for key in native_scenes):
        raise ValueError('Native layout no longer matches the scene listing; recheck its identity and file paths')
    if any(key not in matched_photos and key[0] not in excluded and key not in scene_exclusions for key in photo_reviews):
        raise ValueError('Photo evidence no longer matches a published scene; recheck its identity and file paths')
    if any(key not in matched_contents and key[0] not in excluded and key not in scene_exclusions for key in content_reviews):
        raise ValueError('Content evidence no longer matches the published scene identities')
    thumbnail_output = output / 'thumbnails'
    thumbnail_output.mkdir(exist_ok=True)
    for path in thumbnail_output.iterdir():
        if path.is_file() and not path.is_symlink() and re.fullmatch(r'[a-f0-9]{64}\.jpg', path.name) and path.name not in thumbnails:
            path.unlink()
    for name in thumbnails:
        shutil.copyfile(root / 'data/scene-thumbnails' / name, thumbnail_output / name)
    for shard, mapping in ids.items():
        write(f'ids/{shard}.json', mapping)
    del ids
    for shard, mapping in retained_variants.items():
        write(f'variants/{shard}.json', mapping)
    token_shards = defaultdict(dict)
    for token, values in postings.items():
        shard = hashlib.sha256(token.encode()).hexdigest()[:3]
        token_shards[shard][token] = encoded(values)
    del postings
    for shard, mapping in token_shards.items():
        write(f'tokens/{shard}.json', mapping)
    del token_shards
    facet_manifest = {}
    for field, values in facets.items():
        facet_manifest[field] = {}
        for value, ordinals in values.items():
            key = hashlib.sha256((field + ':' + value).encode()).hexdigest()[:16]
            write(f'facets/{key}.json', {'postings': encoded(ordinals)})
            facet_manifest[field][value] = {'file': key, 'count': len(ordinals)}
    if matched_manifests != set(manifest_reviews):
        raise ValueError('A scene manifest no longer matches a published scene; recheck its selection')
    # Withheld scenes keep their immutable routing assets and audit evidence.
    if (matched_routing != set(photo_routing) - scene_exclusions
            or matched_unresolved != set(unresolved_routing) - scene_exclusions):
        raise ValueError('Photo routing no longer matches the published scenes; rerun the audit')
    if matched_archives != set(photo_archives):
        raise ValueError('Companion routing no longer matches the published selections')
    checked_at = max([registry['checkedAt'], native_policy.get('checkedAt', ''), photo_policy.get('checkedAt', ''), content_policy['checkedAt'], manifest_policy['checkedAt'], routing_policy['checkedAt'], archive_policy['checkedAt'], decision_policy['checkedAt'], *[review['checkedAt'] for review in verified_scenes.values()]])
    manifest = {'schemaVersion': 1, 'generation': generation, 'checkedAt': checked_at, 'total': total,
                'packSize': PACK_SIZE, 'sources': sources, 'facets': facet_manifest, 'kinds': dict(counts),
                'levels': dict(levels), 'delivery': dict(deliveries), 'photos': dict(photos), 'contents': dict(contents),
                'thumbnails': thumbnail_scenes,
                'photoRouting': dict(routing_counts),
                'discovery': {'schemaVersion': 1, 'file': 'feed.json'},
                'incompleteCollections': sum(not source['listingComplete'] for source in sources if source['count']),
                'groupedVariants': grouped_variants,
                'unit': 'named_scene',
                'scope': 'Scene entries grouped within each source and archive, including explicit initialization/refinement variants. Copies across repositories are not globally deduplicated. Native camera/model layouts or stronger complete-scene evidence are checked; full rendering, every photograph and export require separate loading checks. Standalone geometry, inaccessible and known unsupported cases are excluded.'}
    write('feed.json', {'schemaVersion': 1, 'generation': generation, 'rows': discovery})
    write('index.json', manifest)
    write('verified-scenes.json', {'schemaVersion': 1, 'generation': generation, 'scope': manifest['scope'], 'scenes': published_reviews})
    write('photo-audit.json', {'schemaVersion': 1, 'generation': generation, 'checkedAt': checked_at, 'scenes': total,
        'collections': len(sources), 'photos': dict(photos), 'routing': dict(routing_counts), 'decisions': dict(decision_counts), 'scope': photo_policy.get('scope', ''),
        'repeatAudit': dict(Counter(row['repeatAudit'] for row in photo_rows)),
        'limits': 'Pinned path inventories and photo samples are separate from full model, every-photo and export checks. Photos can require a mapping, collection choice or companion archive; their presence does not mean the current link attaches them.'})
    if photo_rows:
        with (output / 'photo-audit.csv').open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(photo_rows[0]))
            writer.writeheader()
            writer.writerows({key: "'" + value if isinstance(value, str) and value.startswith(('=', '+', '-', '@')) else value
                             for key, value in row.items()} for row in photo_rows)
    else:
        (output / 'photo-audit.csv').write_text('', encoding='utf8')
    print(f'Built {total:,} scenes from {len(sources):,} sources with {len(thumbnails):,} distinct attributed previews.', flush=True)


if __name__ == '__main__':
    build()
