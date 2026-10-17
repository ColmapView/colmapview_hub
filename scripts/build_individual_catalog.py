"""Build a bounded, read-only search index for individual public 3D models.

The deployed Worker reads fixed same-origin asset keys. No database, runtime
ingestion, source downloads, or bucket enumeration is needed for catalog reads.
"""

import array
import base64
import gzip
import hashlib
import json
import re
import unicodedata
import urllib.parse
from collections import Counter, defaultdict
from pathlib import Path

from scene_datasets import scene_records
from scene_qualification import native_evidence, native_scene_reviews, qualified_evidence, scene_key, verified_scene_reviews, verified_source_entry

PACK_SIZE = 2048
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
    if (kind == 'colmap' and proof.get('level') == 'native_layout_checked' and proof.get('viewerUrl')
            and proof.get('delivery') in {'browser_readable', 'cors_headers_checked'}
            and compatibility.get('status') == 'native_headers_checked'
            and all(value is None or type(value) is int and value > 0
                    for value in (compatibility.get('cameras'), compatibility.get('images')))
            and compatibility.get('cameraRecordChecked') is True and compatibility.get('poseRecordChecked') is True):
        return True
    validation = proof.get('sceneValidation') or {}
    return (kind in {'colmap', 'cameras', 'camera-scene', 'scene'} and proof.get('level') == 'scene_verified'
            and proof.get('delivery') == 'browser_readable' and bool(proof.get('viewerUrl'))
            and validation.get('status') == 'passed' and validation.get('export') == 'colmap_images'
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
    catalog = read(root / 'data/catalog.json')
    registry_bytes = (root / 'data/individual-datasets.json').read_bytes()
    registry = json.loads(registry_bytes)
    audit = {row['sourceId']: row for row in read(root / 'data/dataset-audit.json')['results']}
    policy_bytes = (root / 'data/scene-exclusions.json').read_bytes()
    scene_exclusions = reviewed_scene_exclusions(catalog, json.loads(policy_bytes))
    verified_bytes = (root / 'data/verified-scenes.json').read_bytes()
    verified_scenes = verified_scene_reviews(catalog, json.loads(verified_bytes))
    native_bytes = (root / 'data/native-layouts.json.gz').read_bytes()
    native_scenes = native_scene_reviews(catalog, json.loads(gzip.decompress(native_bytes)))
    matched_reviews = set()
    matched_native = set()
    published_reviews = []
    excluded = {row['sourceId'] for row in [*catalog['entries'], *audit.values()] if is_access_restricted(row)}
    generation = hashlib.sha256((root / 'data/catalog.json').read_bytes() + registry_bytes
                                + (root / 'data/dataset-audit.json').read_bytes() + policy_bytes + verified_bytes + native_bytes + Path(__file__).read_bytes()
                                + Path(__file__).with_name('scene_qualification.py').read_bytes()
                                + Path(__file__).with_name('scene_datasets.py').read_bytes()).hexdigest()
    output = root / 'public/hub/datasets/individual'
    current = output / 'index.json'
    if current.exists() and read(current).get('generation') == generation:
        print('Individual metadata index is current.', flush=True)
        return
    output.mkdir(parents=True, exist_ok=True)
    for name in ['packs', 'ids', 'tokens', 'facets', 'sources']:
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
    sources, pack, total = [], [], 0
    counts, levels, deliveries = Counter(), Counter(), Counter()

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
            complete = listing['listingComplete']
        elif entry['provider'] == 'public' and any(fact['label'] == 'Collection' for fact in entry['facts']):
            # Existing public entries already identify a scene/subset/variant.
            # Retain that identity rather than treating the whole provider as one model.
            rows = [['scene', entry['title'], None, None]]
        else:
            continue
        source = {'id': entry['id'], 'sourceId': entry['sourceId'], 'title': entry['title'], 'label': dataset_label,
                  'provider': entry['provider'], 'license': entry['license'],
                  **({'licenseCategory': entry['licenseCategory']} if 'licenseCategory' in entry else {}), 'access': entry['access'],
                  'start': total, 'count': 0, 'listingComplete': complete}
        for row in rows:
            kind, path, files, archive = row
            review_key = scene_key(entry['sourceId'], kind, path, archive)
            review = verified_scenes.get(review_key)
            native = native_scenes.get(review_key)
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
            source_proofs.append(proof)
            source_formats.append(format_name)
            if review:
                published_reviews.append(review)
            if not source['count']:
                sources.append(source)
            source['count'] += 1
            item_id = identity(entry['sourceId'], row)
            if item_id in ids[item_id[-24:-22]]:
                raise ValueError('Duplicate individual model identity')
            ids[item_id[-24:-22]][item_id] = total
            gated = entry['access'] == 'gated' or bool(proof and proof.get('delivery') == 'gated')
            level = 'Access required' if gated else proof.get('statusLabel', 'Files listed; load not checked') if proof else 'Extraction required; load unverified' if archive else 'Files listed; load not checked'
            delivery = 'gated' if gated else proof.get('delivery', 'not_tested') if proof else 'not_tested'
            item = [item_id, source_index, kind, path, format_name, archive, files, proof]
            if kind != 'scene' and (kind, path, archive) in scene_details:
                item.append(scene_details[(kind, path, archive)])
            pack.append(item)
            kind_name = 'Gaussian splat' if kind == 'ply' and format_name == 'Gaussian PLY' else KIND_LABELS.get(kind, '3D geometry')
            counts[kind_name] += 1
            levels[level] += 1
            deliveries[delivery] += 1
            for field, value in [('kind', kind_name), ('status', level), ('delivery', delivery),
                                 ('viewer', 'available' if proof and proof.get('viewerUrl') and not gated and not archive and not proof.get('opening') else '')]:
                add_posting(facets[field], value, total)
            for token in tokens(' '.join([path, dataset_label, entry['title'], entry['license'], format_name, kind_name])):
                add_posting(postings, token, total)
            total += 1
            if len(pack) == PACK_SIZE:
                write(f'packs/{(total - 1) // PACK_SIZE}.json', pack)
                pack = []
        if source['count']:
            source_entry = {**verified_source_entry(entry, source_proofs, source_formats), 'facts': [({**fact, 'label': 'Listed 3D assets and model file sets'} if fact['label'] == 'Individual model or scene entries listed' else fact)
                                              for fact in entry['facts']] + [{'label': 'Supported named scene datasets', 'value': str(source['count'])}]}
            write(f'sources/{entry["id"]}.json', source_entry)
        if entry_number % 100 == 0:
            print(f'Indexed {entry_number + 1}/{len(catalog["entries"])} source entries; {total:,} individual records', flush=True)
    if pack:
        write(f'packs/{(total - 1) // PACK_SIZE}.json', pack)
    if any(key not in matched_reviews and key[0] not in excluded for key in verified_scenes):
        raise ValueError('Verified scene no longer matches the scene listing; recheck its identity and file paths')
    if any(key not in matched_native and key[0] not in excluded for key in native_scenes):
        raise ValueError('Native layout no longer matches the scene listing; recheck its identity and file paths')
    for shard, mapping in ids.items():
        write(f'ids/{shard}.json', mapping)
    del ids
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
    manifest = {'schemaVersion': 1, 'generation': generation, 'checkedAt': max((review['checkedAt'] for review in verified_scenes.values()), default=registry['checkedAt']), 'total': total,
                'packSize': PACK_SIZE, 'sources': sources, 'facets': facet_manifest, 'kinds': dict(counts),
                'levels': dict(levels), 'delivery': dict(deliveries),
                'incompleteCollections': sum(not source['listingComplete'] for source in sources if source['count']),
                'unit': 'named_scene',
                'scope': 'Named scenes with checked native camera/model layouts or stronger complete-scene evidence. Original photographs may be present, partial, absent or unverified. Full rendering and export checks are separate evidence tiers. Standalone geometry, inaccessible and known unsupported cases are excluded.'}
    write('index.json', manifest)
    write('verified-scenes.json', {'schemaVersion': 1, 'generation': generation, 'scope': manifest['scope'], 'scenes': published_reviews})
    print(f'Built {total:,} individual records from {len(sources):,} source entries; previews remain on hold.', flush=True)


if __name__ == '__main__':
    build()
