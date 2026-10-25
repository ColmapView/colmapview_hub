"""Inventory Gaussian-link candidates for every currently published scene, offline.

Scene-local ownership and name-only sibling candidates remain separate. This
operator plan never certifies alignment or changes publication evidence.
"""

import argparse
from collections import Counter, defaultdict
import gzip
import json
import re
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlparse

from ..catalog.scene_datasets import scene_root

ASSET_KINDS = {'ply', 'spz', 'sog', 'splat', 'ksplat', 'splat-scene'}
WRAPPERS = {'', '0', '1', '2', 'colmap', 'sparse', 'dense', 'data', 'dataset', 'datasets',
            'scene', 'scenes', 'reconstruction', 'reconstructions', 'train', 'test', 'val',
            'training', 'trained', 'model', 'models', 'output', 'outputs', 'point_cloud'}


def media_scope(kind, path, proof):
    # A photograph may be shared by reconstruction variants in different worlds.
    # Geometry ownership must follow the selected model, never the photo folder.
    scope = scene_root(kind, path)
    if scope.rsplit('/', 1)[-1].isdigit() and scope.rpartition('/')[0].rsplit('/', 1)[-1].casefold() in {'colmap', 'cam', 'cameras'}:
        scope = scope.rpartition('/')[0]
    while scope.rsplit('/', 1)[-1].casefold() in {'colmap', 'cam', 'cameras'}:
        scope = scope.rpartition('/')[0]
    return scope


def read(path):
    body = path.read_bytes()
    return json.loads(gzip.decompress(body) if path.suffix == '.gz' else body)


def listed_geometry(raw_items, scenes):
    """Include embedded companions, standalone assets and existing checked badges."""
    expanded = []
    for kind, path, files, archive in raw_items:
        expanded.extend([PurePosixPath(value).suffix.lstrip('.'), value, None, archive] for value in (files or {}).values()
                        if PurePosixPath(value).suffix.lstrip('.') in ASSET_KINDS)
        if kind != 'splat-scene':
            expanded.append([kind, path, files, archive])
    for scene in scenes:
        sample = (scene.get('availableSplats') or {}).get('samplePath', '')
        suffix = PurePosixPath(sample).suffix.lstrip('.')
        if suffix in ASSET_KINDS and not sample.startswith(('https://', 'http://')):
            expanded.append([suffix, sample, None, scene['archive']])
    seen = set()
    for kind, path, files, archive in expanded:
        if kind in ASSET_KINDS and (kind, path, archive) not in seen:
            seen.add((kind, path, archive))
            yield kind, path, files, archive


def plan(root):
    base = root / 'public/hub/datasets/individual'
    index = read(base / 'index.json')
    registry = {item['datasetId']: item for item in read(root / 'data/individual-datasets.json')['sources']}
    parents = {item['sourceId']: item for item in read(root / 'data/catalog.json')['entries']}
    historical = read(root / 'data/scene-component-audit.json.gz')
    headers = {(item['sourceId'], item.get('revision'), item['path']): item for item in historical['assetChecks']}
    rows = [row for path in sorted((base / 'packs').glob('*.json')) for row in read(path)]
    assert len(rows) == index['total'] and len({row[0] for row in rows}) == len(rows)
    scenes, by_source, owners, tokens = [], defaultdict(list), defaultdict(list), defaultdict(set)
    for row in rows:
        source = index['sources'][row[1]]
        proof = row[7] or {}
        scope = media_scope(row[2], row[3], proof)
        item = {'id': row[0], 'source': row[1], 'kind': row[2], 'path': row[3], 'scope': scope,
                'archive': row[5], 'files': row[6],
                'viewerUrl': (proof.get('gaussianRouting') or {}).get('baseViewerUrl') or proof.get('viewerUrl'),
                'availableSplats': (proof.get('availableData') or {}).get('splats'),
                'localAssets': [], 'siblingCandidates': []}
        scenes.append(item)
        by_source[row[1]].append(item)
        owners[(row[1], row[5], scope)].append(item['id'])
        leaf = scope.rsplit('/', 1)[-1]
        if leaf.casefold() not in WRAPPERS and len(leaf) > 1:
            tokens[(row[1], leaf.casefold())].add(item['id'])
    scene_map = {item['id']: item for item in scenes}
    sources, assets = [], []
    for number, source in enumerate(index['sources']):
        registration = registry.get(source['id'])
        parent = parents.get(source['sourceId'], {})
        revision = next((fact['value'] for fact in parent.get('facts', []) if fact['label'] == 'Pinned revision'), None)
        listing = read(root / 'data/individual-datasets' / registration['file']) if registration else None
        sources.append({'id': source['id'], 'sourceId': source['sourceId'], 'revision': revision,
                        'scenes': len(by_source[number]), 'listingComplete': bool(listing and listing['listingComplete']),
                        'inventoryFile': registration['file'] if registration else None})
        raw_items = (listing or {}).get('items', [])
        for kind, path, files, archive in listed_geometry(raw_items, by_source[number]):
            asset = {'source': number, 'kind': kind, 'path': path, 'archive': archive, 'files': files,
                     'owners': [], 'nameCandidates': [], 'header': headers.get((source['sourceId'], revision, path))}
            directory = path if kind == 'splat-scene' else str(PurePosixPath(path).parent)
            if directory == '.':
                directory = ''
            while True:
                asset['owners'] = owners.get((number, archive, directory), [])
                if asset['owners'] or not directory:
                    break
                directory = directory.rpartition('/')[0]
            if asset['owners'] and not directory and not any(path in (scene_map[owner]['files'] or {}).values() for owner in asset['owners']):
                asset['owners'] = []  # A root model does not own unrelated repository objects.
            candidates = set()
            if not asset['owners']:
                for part in [*PurePosixPath(path).parts[:-1], PurePosixPath(path).stem]:
                    if part.casefold() not in WRAPPERS:
                        candidates.update(tokens.get((number, part.casefold()), []))
                asset['nameCandidates'] = sorted(candidates)
            if source['sourceId'] in {'hf:boazkg/gs-pool-paslcd', 'hf:boazkg/gs-pool-cl-splats'}:
                member = re.match(r'^members/(.+/Instance_\d+/(?:joint|anchored))/', path)
                if member:
                    time = re.search(r'/(t[12])/', path, re.I) or re.search(r'/(T[12])_change\.ply$', path)
                    asset['nameCandidates'] = [scene['id'] for scene in by_source[number]
                        if scene['scope'].startswith('inputs/' + member[1] + '/')
                        and (not re.search(r'/solve/t[12]$', scene['scope'])
                             or time and scene['scope'].endswith('/solve/' + time[1].lower()))]
                    asset['associationRule'] = 'gs_pool_capture_and_time'
            if source['sourceId'] == 'hf:Jamesbass/bigsur-360-colmap' and path in {'splats/bigsur_v2.ply', 'bigsur_v2_full_quality.sog'}:
                # Pinned publisher README explicitly states these share the native
                # sparse/0 coordinate frame; a root folder alone is insufficient.
                asset['nameCandidates'] = [scene['id'] for scene in by_source[number] if scene['path'] == 'sparse/0']
                asset['associationRule'] = 'publisher_shared_world'
            if source['sourceId'] == 'hf:Yiwen-ntu/GaussianEditor_Result' and path in {'bear_origin.splat', 'bear.splat', 'face.splat', 'face_trump.splat'}:
                leaf = path.split('_')[0].split('.')[0]
                asset['nameCandidates'] = [scene['id'] for scene in by_source[number] if scene['scope'].rsplit('/', 1)[-1] == leaf]
                asset['associationRule'] = 'sampled_identical_gaussian_positions'
            position = len(assets)
            assets.append(asset)
            for scene_id in asset['owners']:
                scene_map[scene_id]['localAssets'].append(position)
            for scene_id in asset['nameCandidates']:
                scene_map[scene_id]['siblingCandidates'].append(position)
    linked = 0
    for scene in scenes:
        query = parse_qs(urlparse(scene['viewerUrl'] or '').query)
        target = query.get('url', [''])[0]
        scene['explicitSplats'] = []
        scene['geometryLinked'] = False
        scene['discoveryEnabled'] = True
        name = PurePosixPath(urlparse(target).path).name
        manifest_file = base / 'manifests' / name
        if name.endswith('.manifest.json') and manifest_file.is_file():
            scene['geometryLinked'] = any(item.get('role') == 'splat' for item in read(manifest_file).get('geometryFiles', []))
            manifest = read(manifest_file)
            scene['explicitSplats'] = manifest.get('splats', [])
            scene['discoveryEnabled'] = 'splats' not in manifest
        linked += bool(scene['explicitSplats'])
    return {'schemaVersion': 1, 'baselineGeneration': index['generation'],
            'scope': 'All current published scenes and their pinned local source inventories. Names identify review candidates only; neither filenames nor header checks certify coordinate alignment.',
            'summary': {'scenes': len(scenes), 'sources': len(sources), 'assets': len(assets),
                        'explicitSplatScenes': linked,
                        'sceneLocalAssets': sum(bool(item['owners']) for item in assets),
                        'siblingCandidateAssets': sum(bool(item['nameCandidates']) for item in assets),
                        'previouslyCheckedRoles': dict(Counter((item['header'] or {}).get('role', 'unchecked') for item in assets)),
                        'scenesWithCandidates': sum(bool(item['localAssets'] or item['siblingCandidates']) for item in scenes)},
            'sources': sources, 'scenes': scenes, 'assets': assets}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--output', type=Path, default=Path('.tmp/splat-link-audit-20261025/plan.json'))
    args = parser.parse_args()
    result = plan(args.root)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(result['summary']))
