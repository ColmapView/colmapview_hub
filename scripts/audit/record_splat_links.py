"""Seal prepared Gaussian associations and retain a complete published-scene audit."""

import argparse
import gzip
import json
import re
from collections import Counter
from pathlib import Path

from ..catalog.photo_routing import json_bytes
from ..catalog.splat_routing import digest, splat_reviews


def record(root, audit_dir):
    prepared = json.loads((audit_dir / 'prepared.json').read_bytes())
    plan = json.loads((audit_dir / 'plan.json').read_bytes())
    if (len(prepared['report']) != len(plan['scenes'])
            or {row['id'] for row in prepared['report']} != {row['id'] for row in plan['scenes']}
            or any(row['status'] == 'preparation_failed' for row in prepared['report'])):
        raise ValueError('Audit must cover every published scene without preparation errors')
    routes = []
    for route in prepared['routes']:
        item = dict(route)
        item['receiptSha256'] = digest(item)
        routes.append(item)
    policy = {key: prepared[key] for key in ('schemaVersion', 'checkedAt', 'viewerVersion', 'viewerCommit', 'scope')}
    policy['routes'] = routes
    splat_reviews(json.loads((root / 'data/catalog.json').read_bytes()), policy)
    # All source assets remain inventoried, even when no current card owns them.
    selected = {(r['sourceId'], a['path']) for r in routes for a in r['assets']}
    fresh = { (r['sourceId'], r['path']): r for r in [json.loads(line) for line in (audit_dir / 'headers.ndjson').read_text(encoding='utf-8').splitlines() if line] }
    fresh.update({(r['sourceId'], r['path']): r for r in json.loads((audit_dir / 'raw-headers.json').read_bytes())})
    assets = []
    for asset in plan['assets']:
        source = plan['sources'][asset['source']]
        key = (source['sourceId'], asset['path'])
        check = fresh.get(key) or asset.get('header') or {}
        role = check.get('role')
        if key in selected:
            status = 'linked'
        elif role in ('splats', 'gaussian-splat'):
            status = ('unsupported_encoding' if check.get('encoding') else 'empty_geometry' if check.get('vertices') == 0
                      else 'other_temporal_frame' if (asset['owners'] or asset['nameCandidates']) and asset['path'].split('/')[-1].removesuffix('.ply').removeprefix('frame_').isdigit()
                      else 'no_confirmed_published_scene_association')
        elif check.get('status') == 'header_checked':
            status = 'not_gaussian'
        elif (asset['owners'] or asset['nameCandidates']) and re.fullmatch(r'(?:frame_)?\d{4,}\.ply', asset['path'].split('/')[-1]):
            status = 'unsampled_temporal_frame'
        else:
            status = 'outside_published_scene_candidates'
        assets.append({'sourceId': key[0], 'revision': source['revision'], 'path': key[1], 'status': status,
                       'role': role, 'owners': asset['owners'], 'candidateScenes': asset['nameCandidates']})
    audit = {key: prepared[key] for key in ('schemaVersion', 'checkedAt', 'scope', 'baselineGeneration')}
    audit.update(sources=plan['sources'], scenes=prepared['report'], assets=assets,
                 summary={'scenes': len(prepared['report']), 'collections': len(plan['sources']), 'linkedScenes': len(routes),
                          'assetBindings': sum(len(r['assets']) for r in routes), 'uniqueLinkedAssets': len(selected),
                          'sceneStatuses': dict(Counter(r['status'] for r in prepared['report'])),
                          'assetStatuses': dict(Counter(r['status'] for r in assets))})
    for name, value in [('gaussian-routing.json.gz', policy), ('gaussian-link-audit.json.gz', audit)]:
        (root / 'data' / name).write_bytes(gzip.compress(json_bytes(value), mtime=0))
    print(json.dumps(audit['summary']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit-dir', type=Path, required=True)
    args = parser.parse_args()
    record(Path.cwd(), args.audit_dir.resolve())
