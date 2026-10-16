"""Normalize public file listings into durable, revision-pinned individual model records.

Reads metadata only. Photographs, masks, and previews are never downloaded. A file
listing establishes identity, not decoder support, browser access, or a successful load.
"""

import argparse
import concurrent.futures
import gzip
import hashlib
import json
import re
import urllib.parse
from collections import Counter
from pathlib import Path

from dataset_audit import Network, model_sets, now

ASSETS = {'.ply': 'ply', '.spz': 'spz', '.sog': 'sog', '.splat': 'splat', '.ksplat': 'ksplat',
          '.obj': 'obj', '.glb': 'glb', '.gltf': 'gltf', '.pcd': 'pcd', '.las': 'las',
          '.laz': 'laz', '.off': 'off', '.stl': 'stl', '.usd': 'usd', '.usdz': 'usdz'}
CAMERA = re.compile(r'(?:^|/)(?:transforms(?:_[^/]*)?\.json|poses_bounds\.npy|cameras(?:_[^/]*)?\.npz)$', re.I)
MEDIA = re.compile(r'^(?:images?(?:_\d+)?|rgb|rgba|photos?|masks?|depth|depths|normal|normals|videos?|frames)$', re.I)


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


def write_pack(path, value):
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()
    path.write_bytes(gzip.compress(raw, mtime=0))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def individual_records(paths, archive=None):
    """One COLMAP file set is one item; each standalone 3D model is another item."""
    models, cameras = model_sets(paths)
    consumed = set()
    rows = []
    for kind, groups in [('colmap', models), ('cameras', cameras)]:
        for group in groups:
            consumed.update(group['files'].values())
            rows.append([kind, group['directory'], group['files'], archive])
    camera_dirs = {row[1] for row in rows}
    for path in sorted(set(paths)):
        if path in consumed or path.endswith('/') or path.startswith('__MACOSX/'):
            continue
        extension = Path(path).suffix.lower()
        if extension in ASSETS:
            rows.append([ASSETS[extension], path, None, archive])
        elif CAMERA.search(path) and path.rpartition('/')[0] not in camera_dirs:
            rows.append(['camera-metadata', path, None, archive])
    return group_components(rows)


def group_components(rows):
    """Attach a scene's companion PLY components to its unique reconstruction.

    For example, NGS inside_gaussians.ply and surface_gaussians.ply belong to
    the same scene as sparse/0. They are linked assets, not extra scene counts.
    Ambiguous roots with multiple reconstructions are deliberately left alone.
    """
    roots = {}
    for row in rows:
        if row[0] != 'colmap':
            continue
        root = re.sub(r'(?:^|/)(?:colmap/)?sparse/(?:\d+)$', '', row[1], flags=re.I)
        if root == row[1]:
            continue
        roots.setdefault((row[3], root), []).append(row)
    roots = [(archive, root, group[0]) for (archive, root), group in roots.items() if len(group) == 1]
    roots.sort(key=lambda value: len(value[1]), reverse=True)
    retained = []
    for row in rows:
        attached = False
        companion = Path(row[1]).name.lower() in {'inside_gaussians.ply', 'surface_gaussians.ply', 'point_cloud.ply',
                                                   'points3d.ply', 'fused.ply', 'fused_aligned.ply', 'input.ply', 'gaussians.ply'}
        if row[0] == 'ply' and companion:
            for archive, root, model in roots:
                if row[3] == archive and (not root or row[1].startswith(root + '/')):
                    model[2]['asset:' + row[1]] = row[1]
                    attached = True
                    break
        if not attached:
            retained.append(row)
    pairs = {}
    for row in retained:
        if row[0] == 'ply' and Path(row[1]).name.lower() in {'inside_gaussians.ply', 'surface_gaussians.ply'}:
            pairs.setdefault((row[3], row[1].rpartition('/')[0]), []).append(row)
    paired = {id(row) for group in pairs.values() if len(group) == 2 for row in group}
    retained = [row for row in retained if id(row) not in paired]
    for (archive, root), group in pairs.items():
        if len(group) == 2:
            retained.append(['splat-scene', root, {'asset:' + row[1]: row[1] for row in group}, archive])
    return sorted(retained, key=lambda row: (row[3] or '', row[1], row[0]))


def refresh_model_listing(repo, revision, network, cache):
    """Walk folders without the API's 100,000-sibling cap; omit media-only folders.

    This enumerates model/metadata paths, not every photograph. Pagination is
    exhausted at each visited directory, and all requests stay on the pinned
    public repository API. The receipt records the deliberately omitted folders.
    """
    target = cache / (hashlib.sha256((repo + '@' + revision).encode()).hexdigest() + '.json.gz')
    if target.exists():
        return read(target)
    base = f'https://huggingface.co/api/datasets/{urllib.parse.quote(repo, safe="/")}/tree/{revision}'
    pending, paths, skipped = [''], [], []

    def folder(path):
        url = base + ('/' + urllib.parse.quote(path, safe='/') if path else '') + '?recursive=false&expand=false&limit=1000'
        children, files = [], []
        while url:
            parsed = urllib.parse.urlsplit(url)
            if parsed.netloc != 'huggingface.co' or not parsed.path.startswith(urllib.parse.urlsplit(base).path):
                raise ValueError('Unexpected metadata pagination URL')
            body, headers, _, _ = network.fetch(url, limit=4 * 1024 * 1024, api=True)
            page = json.loads(body)
            if not isinstance(page, list):
                raise ValueError('Expected a public repository directory listing')
            for entry in page:
                if entry.get('type') == 'directory':
                    children.append(entry['path'])
                elif entry.get('type') == 'file':
                    files.append(entry['path'])
            match = re.search(r'<([^>]+)>;\s*rel="next"', headers.get('link', ''))
            url = match.group(1) if match else None
        return children, files

    visited = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        while pending:
            batch, pending = pending[:64], pending[64:]
            for children, files in pool.map(folder, batch):
                visited += 1
                paths.extend(files)
                for child in children:
                    if MEDIA.fullmatch(child.rsplit('/', 1)[-1]):
                        skipped.append(child)
                    else:
                        pending.append(child)
            if visited > 20000:
                raise ValueError('Model directory walk exceeded its explicit bound')
    result = {'id': repo, 'revision': revision, 'checkedAt': now(), 'paths': sorted(set(paths)),
              'listingComplete': True, 'scope': 'Model-directory walk; photograph, mask, depth, and video directories omitted.',
              'omittedMediaDirectories': len(skipped), 'visitedDirectories': visited}
    cache.mkdir(parents=True, exist_ok=True)
    write_pack(target, result)
    return result


def prepare(catalog, metadata_dir, old_inventory, output, refresh_sources=(), cache=Path('.tmp/model-listings')):
    output.mkdir(parents=True, exist_ok=True)
    metadata = {}
    for path in metadata_dir.glob('*.json.gz'):
        item = read(path)
        metadata[item['id']] = path
    old = {item['id']: item for item in read(old_inventory)['datasets']} if old_inventory else {}
    manifest = {'schemaVersion': 1, 'checkedAt': now()[:10], 'sources': [],
                'scope': 'Individual listed model folders and standalone 3D assets; no complete load certification. Archive and capped-listing coverage is recorded per collection.'}
    counts = Counter()
    network = Network()
    for entry in catalog['entries']:
        if entry['provider'] != 'huggingface':
            continue
        repo = entry['sourceId'][3:]
        if repo not in metadata:
            continue
        listing = read(metadata[repo])
        if listing.get('availability') != 'public':
            continue
        revision = listing.get('revision')
        expected = next((fact['value'] for fact in entry['facts'] if fact['label'] == 'Pinned revision'), None)
        if revision != expected:
            raise ValueError(f'Revision mismatch for {repo}; refresh the catalog first')
        if repo in refresh_sources:
            print(f'Enumerating model directories: {repo}', flush=True)
            listing = refresh_model_listing(repo, revision, network, cache)
        rows = individual_records(listing.get('paths', []))
        previous = old.get(repo, {})
        sample = previous.get('archive_sample', {})
        # Keep all positively identified models in the earlier sampled ZIP
        # directory, only when it is the same pinned repository revision.
        if sample.get('revision') == revision and sample.get('verified'):
            for model in sample.get('colmap_models', []):
                rows.append(['colmap', model['directory'], model['files'], sample['archive']])
            for path in sample.get('splat_files', []):
                if isinstance(path, str):
                    rows.append([ASSETS.get(Path(path).suffix.lower(), 'splat'), path, None, sample['archive']])
            for probe in sample.get('ply_probes', []):
                if probe.get('path'):
                    rows.append(['ply', probe['path'], None, sample['archive']])
        rows = list({(row[0], row[1], row[3]): row for row in rows}.values())
        rows = group_components(rows)
        value = {'schemaVersion': 1, 'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'revision': revision,
                 'checkedAt': listing['checkedAt'][:10], 'listingComplete': listing.get('listingComplete') is True,
                 'scope': listing.get('scope', 'Public repository sibling listing; capped listings remain incomplete.'),
                 'archiveCoverage': 'Previously inspected ZIP models only; other archives and nested contents are not enumerated.', 'items': rows}
        filename = entry['id'] + '.json.gz'
        digest = write_pack(output / filename, value)
        counts.update(row[0] for row in rows)
        manifest['sources'].append({'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'file': filename,
                                    'sha256': digest, 'count': len(rows), 'listingComplete': value['listingComplete'],
                                    'revision': revision, 'checkedAt': value['checkedAt'], 'scope': value['scope'],
                                    'looseColmapCount': sum(row[0] == 'colmap' and not row[3] for row in rows),
                                    'plyFileCount': sum(path.lower().endswith('.ply') for path in listing.get('paths', []))})
    manifest['counts'] = dict(sorted(counts.items()))
    manifest['individualEntries'] = sum(counts.values())
    (output.parent / 'individual-datasets.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'entries': manifest['individualEntries'], 'collections': len(manifest['sources']), 'kinds': dict(counts)}, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', type=Path, default=Path('data/catalog.json'))
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--old-inventory', type=Path)
    parser.add_argument('--out', type=Path, default=Path('data/individual-datasets'))
    parser.add_argument('--refresh-model-source', action='append', default=[])
    args = parser.parse_args()
    prepare(read(args.catalog), args.metadata, args.old_inventory, args.out, args.refresh_model_source)
