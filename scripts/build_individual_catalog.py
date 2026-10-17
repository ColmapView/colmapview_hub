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

PACK_SIZE = 2048
FORMATS = {'colmap': 'COLMAP', 'cameras': 'COLMAP cameras and poses', 'ply': 'PLY (header unchecked)',
           'spz': 'SPZ (header unchecked)', 'sog': 'SOG (header unchecked)', 'splat': 'SPLAT (header unchecked)',
           'ksplat': 'KSPLAT (header unchecked)', 'splat-scene': 'Gaussian components (headers unchecked)', 'camera-metadata': 'Camera metadata'}
AUDIT_FORMATS = {'colmap': 'COLMAP', 'point_cloud_ply': 'XYZ point-cloud PLY', 'gaussian_ply': 'Gaussian PLY',
                 'spz': 'SPZ', 'spz_v4': 'SPZ version 4', 'sog': 'SOG', 'zstd_wrapped_splat': 'Zstandard-compressed splat'}
KIND_LABELS = {'colmap': 'COLMAP reconstruction', 'cameras': 'Cameras and poses', 'ply': 'PLY model',
               'spz': 'Gaussian splat', 'sog': 'Gaussian splat', 'splat': 'Gaussian splat', 'ksplat': 'Gaussian splat',
               'camera-metadata': 'Camera metadata', 'splat-scene': 'Gaussian splat', 'scene': 'Public scene'}


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


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
    if archive:
        matched = any(probe.get('url') == candidate and probe.get('modelDirectory') == path
                      for probe in result.get('probes', []))
    elif kind in ('colmap', 'cameras'):
        matched = result.get('modelDirectory') == path and result.get('revision') == revision
    else:
        matched = candidate == result.get('loadUrl') or any(probe.get('url') == candidate and probe.get('format')
                                                           for probe in result.get('probes', []))
    companion_sample = False
    if not matched and not archive and kind == 'colmap':
        for role, value in (files or {}).items():
            if role.startswith('asset:') and hf_url(entry, revision, value) == result.get('loadUrl'):
                candidate = result['loadUrl']
                companion_sample = matched = True
                break
    if not matched or entry['status'] == 'unsupported_content':
        return None, FORMATS.get(kind, '.' + kind)
    proof = dict(entry.get('verification', {}))
    proof['statusLabel'] = entry['statusLabel']
    imported = result.get('viewerImport', {})
    proof['scope'] = 'This recorded model or file only. Other collection entries, source photos, and masks have separate evidence.'
    matching_probe = next((probe for probe in result.get('probes', []) if probe.get('url') == candidate), {})
    format_name = AUDIT_FORMATS.get(matching_probe.get('format'), FORMATS.get(kind, '.' + kind))
    if companion_sample:
        proof['scope'] = 'Only the linked companion model file was checked. The listed COLMAP reconstruction, remaining assets, source photos, and masks need their own checks.'
        format_name = 'COLMAP files listed · ' + format_name
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
    if entry.get('viewerUrl') and proof['delivery'] == 'browser_readable' and candidate.rstrip('/') == result.get('loadUrl', '').rstrip('/') and not archive and not unsupported:
        proof['viewerUrl'] = entry['viewerUrl']
    return proof, format_name


def build(root=Path('.')):
    catalog = read(root / 'data/catalog.json')
    registry_bytes = (root / 'data/individual-datasets.json').read_bytes()
    registry = json.loads(registry_bytes)
    audit = {row['sourceId']: row for row in read(root / 'data/dataset-audit.json')['results']}
    generation = hashlib.sha256((root / 'data/catalog.json').read_bytes() + registry_bytes
                                + (root / 'data/dataset-audit.json').read_bytes() + Path(__file__).read_bytes()).hexdigest()
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

    for entry in catalog['entries']:
        source_index = len(sources)
        dataset_label = label(entry)
        registered = by_dataset.get(entry['id'])
        complete = True
        revision = None
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
            rows = listing['items']
            complete = listing['listingComplete']
        elif entry['provider'] == 'public' and any(fact['label'] == 'Collection' for fact in entry['facts']):
            # Existing public entries already identify a scene/subset/variant.
            # Retain that identity rather than treating the whole provider as one model.
            rows = [['scene', entry['title'], None, None]]
        else:
            continue
        source = {'id': entry['id'], 'sourceId': entry['sourceId'], 'title': entry['title'], 'label': dataset_label,
                  'provider': entry['provider'], 'license': entry['license'], 'licenseCategory': entry['licenseCategory'], 'access': entry['access'],
                  'start': total, 'count': len(rows), 'listingComplete': complete}
        sources.append(source)
        write(f'sources/{entry["id"]}.json', entry)
        result = audit.get(entry['sourceId'], {})
        for row in rows:
            kind, path, files, archive = row
            item_id = identity(entry['sourceId'], row)
            if item_id in ids[item_id[-24:-22]]:
                raise ValueError('Duplicate individual model identity')
            ids[item_id[-24:-22]][item_id] = total
            if kind == 'scene':
                proof = {**entry.get('verification', {}), 'statusLabel': entry['statusLabel']}
                if entry.get('viewerUrl'):
                    proof['viewerUrl'] = entry['viewerUrl']
                format_name = ' · '.join(entry['formats']) or 'Not established'
            elif entry['provider'] == 'huggingface':
                proof, format_name = item_evidence(entry, row, revision, result)
            else:
                proof, format_name = None, FORMATS.get(kind, '.' + kind)
            level = proof.get('statusLabel', 'Files listed; load not checked') if proof else 'Files listed; load not checked'
            delivery = proof.get('delivery', 'not_tested') if proof else ('gated' if entry['access'] == 'gated' else 'not_tested')
            item = [item_id, source_index, kind, path, format_name, archive, files, proof]
            pack.append(item)
            kind_name = 'Gaussian splat' if kind == 'ply' and format_name == 'Gaussian PLY' else KIND_LABELS.get(kind, '3D geometry')
            counts[kind_name] += 1
            levels[level] += 1
            deliveries[delivery] += 1
            for field, value in [('kind', kind_name), ('status', level), ('delivery', delivery),
                                 ('viewer', 'available' if proof and proof.get('viewerUrl') else '')]:
                add_posting(facets[field], value, total)
            for token in tokens(' '.join([path, dataset_label, entry['title'], entry['license'], format_name, kind_name])):
                add_posting(postings, token, total)
            total += 1
            if len(pack) == PACK_SIZE:
                write(f'packs/{(total - 1) // PACK_SIZE}.json', pack)
                pack = []
        if source_index % 100 == 0:
            print(f'Indexed {source_index + 1}/{len(catalog["entries"])} source entries; {total:,} individual records', flush=True)
    if pack:
        write(f'packs/{(total - 1) // PACK_SIZE}.json', pack)
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
    manifest = {'schemaVersion': 1, 'generation': generation, 'checkedAt': registry['checkedAt'], 'total': total,
                'packSize': PACK_SIZE, 'sources': sources, 'facets': facet_manifest, 'kinds': dict(counts),
                'levels': dict(levels), 'delivery': dict(deliveries),
                'incompleteCollections': sum(not source['listingComplete'] for source in sources),
                'scope': registry['scope']}
    write('index.json', manifest)
    print(f'Built {total:,} individual records from {len(sources):,} source entries; previews remain on hold.', flush=True)


if __name__ == '__main__':
    build()
