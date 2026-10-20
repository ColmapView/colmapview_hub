"""Audit published zero counts using pinned offline source and export receipts.

No network access. Supply the index and packs from the same generation. Reuse
confirmed scoped findings until their source pin, selected files or evidence change.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import gzip
import hashlib
import json
import re
from pathlib import Path


def read(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if path.suffix == '.gz' else raw)


def effective_counts(proof):
    # Preserve the original native counts as evidence, but audit the actual launch
    # selection. Checked XYZ manifests can deliberately replace an empty native file.
    return ((proof.get('sceneManifest') or {}).get('counts')
            or proof.get('sceneValidation') or proof.get('sceneCompatibility') or {})


def finding(source_id, proof, previous):
    data = proof.get('availableData', {})
    cloud = data.get('point_cloud', {})
    if cloud and cloud.get('status') != 'archive':
        return 'static_cloud_requires_binding'
    if cloud.get('status') == 'archive' or data.get('splats', {}).get('status') == 'archive':
        return 'animated_geometry_archive'
    if 'meshes' in data:
        return 'mesh_only'
    if source_id in ('hf:Wuuu3511/bmvs_sparse_dtu2', 'hf:Zqlin/TwinWorld_Datasets'):
        return 'alternate_model_only'
    if previous.get('findings', {}).get('point_cloud') == 'container_review':
        return 'auxiliary_container_review'
    if previous.get('findings', {}).get('point_cloud') == 'not_listed_in_checked_scope' and previous.get('scopeComplete') is True:
        return 'no_points_in_checked_scope'
    return 'unresolved_geometry_association'


NOTES = {
    'recovered': 'Original source geometry passed browser import, COLMAP export and independent XYZ/RGB and camera checks. The prior zero-point receipt is superseded.',
    'gaussian_frame_loaded': 'A complete selected Gaussian frame loaded with its original cameras and checked publisher world translation. The native COLMAP sparse-point count correctly remains zero. Video decoding and the full timeline are outside this launch.',
    'static_cloud_requires_binding': 'A source point cloud exists. The current launch does not select it. Explicit path selection and camera-world alignment/export checks are still required.',
    'animated_geometry_archive': 'Geometry is supplied as separate frame sequences in archives. A zero static sparse-point count does not mean the dataset has no geometry. Temporal selection and association remain separate.',
    'mesh_only': 'A checked mesh exists. Mesh vertices are not a sparse reconstruction point cloud; no conversion or synthetic sparse points were added.',
    'alternate_model_only': 'This selected model has no native points. Other reconstruction/training models in the collection contain geometry; it is not borrowed across model or held-out-view boundaries.',
    'auxiliary_container_review': 'No loose static cloud was found. Auxiliary NPZ/NPY containers remain a separate review scope; their names alone do not prove absence of embedded geometry.',
    'no_points_in_checked_scope': 'No static point source was listed in the complete checked scene scope. This is a revision-bound scoped finding, not a claim that no geometry exists anywhere in the collection.',
    'no_points_in_auxiliary_containers': 'The remaining non-depth auxiliary arrays were inspected at this revision: camera matrices, pose/bounds or two-channel pixel flow, without static XYZ geometry. Source receipts are retained so the same confirmed scope need not be fetched again.',
    'unresolved_geometry_association': 'The existing source evidence cannot confirm a scene-local point source or its absence. Keep the selected-model count separate from collection-wide geometry.',
}


def audit(index, rows, prior, exports=(), confirmations=()):
    if len(rows) != index['total'] or len({row[0] for row in rows}) != len(rows):
        raise ValueError('Audit requires the complete same-generation scene inventory')
    previous = {row['id']: row for row in prior['scenes']}
    checked = {row['id']: row for row in exports}
    confirmed = {row['id']: row for row in confirmations}
    sources, source_indices, scenes, seen = [], {}, [], set()
    for row in rows:
        counts = effective_counts(row[7] or {})
        if type(counts.get('points')) is not int or counts['points'] != 0:
            continue
        scene_id, ordinal, kind, path, _, archive, files, proof = row[:8]
        if scene_id in seen:
            raise ValueError('Duplicate published scene')
        seen.add(scene_id)
        source = index['sources'][ordinal]
        old = previous.get(scene_id)
        if not old:
            raise ValueError('Zero-point scene lacks a scoped source audit: ' + scene_id)
        source_audit = prior['sources'][old['source']]
        native = proof.get('sceneValidation') or proof.get('sceneCompatibility') or {}
        if (source_audit['sourceId'] != source['sourceId'] or old['kind'] != kind
                or native.get('revision') != source_audit['revision']
                or old['path'] != path or old['files'] != files or archive):
            raise ValueError('Prior audit source/model selection changed: ' + scene_id)
        source_id = source['sourceId']
        if source_id not in source_indices:
            source_indices[source_id] = len(sources)
            sources.append(source_audit)
        status = finding(source_id, proof, old)
        result = {'id': scene_id, 'source': source_indices[source_id], 'kind': kind, 'path': path,
                  'files': files, 'previousCounts': counts, 'finding': status,
                  'scope': old['scope'], 'scopeComplete': old['scopeComplete'],
                  'inventoryFinding': old.get('findings', {}).get('point_cloud'),
                  'availableGeometry': {key: value for key, value in proof.get('availableData', {}).items()
                                        if key in ('point_cloud', 'splats', 'meshes', 'geometry')},
                  'hubUrl': 'https://colmapview.opsiclear.com/hub/datasets/open/' + scene_id}
        exported = checked.get(scene_id)
        if exported:
            geometry = exported.get('selectedGeometry', {})
            gaussian = (geometry.get('role') == 'splat' and type(geometry.get('count')) is int and geometry['count'] > 0
                        and isinstance(geometry.get('frame'), str) and re.fullmatch(r'\d{7}', geometry['frame'])
                        and type(geometry.get('frameCount')) is int and geometry['frameCount'] > 0
                        and exported.get('counts', {}).get('points') == 0
                        and all(exported.get(key) == 'passed' for key in
                                ('splatValues', 'splatWorldTransform', 'frameMembership', 'frameCameraNames')))
            if (exported.get('status') != 'passed' or exported.get('pointValues') != 'passed'
                    or exported.get('sourceId') != source_id or not gaussian and exported.get('counts', {}).get('points', 0) <= 0
                    or (any(exported['counts'][key] != counts[key] for key in ('images', 'cameras'))
                        and not verified_frame_selection(exported, counts))
                    or not all(re.fullmatch('[a-f0-9]{64}', exported.get(key, '')) for key in ('sourceSha256', 'exportSha256'))):
                raise ValueError('Replacement export lacks independent source-point/camera evidence: ' + scene_id)
            result.update(finding='gaussian_frame_loaded' if gaussian else 'recovered', counts=exported['counts'], verification=exported)
        result['summary'] = NOTES[result['finding']]
        identity = {'sourceId': source_id, 'revision': source_audit['revision'], 'kind': kind, 'path': path, 'files': files,
                    'inventorySha256': source_audit.get('inventorySha256'), 'geometry': result['availableGeometry']}
        result['evidenceKey'] = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        confirmation = confirmed.get(scene_id)
        if confirmation:
            if (result['finding'] != 'auxiliary_container_review' or confirmation.get('sourceId') != source_id
                    or confirmation.get('revision') != source_audit['revision'] or confirmation.get('evidenceKey') != result['evidenceKey']
                    or confirmation.get('status') != 'passed' or confirmation.get('conclusion') != 'camera_or_2d_flow_only'
                    or type(confirmation.get('containers')) is not int or confirmation['containers'] < 1
                    or not re.fullmatch('[a-f0-9]{64}', confirmation.get('inspectionSha256', ''))):
                raise ValueError('Auxiliary confirmation differs from its pinned scene and inspected scope')
            result.update(finding='no_points_in_auxiliary_containers', confirmation=confirmation)
            result['summary'] = NOTES[result['finding']]
        scenes.append(result)
    return {'schemaVersion': 1, 'checkedAt': datetime.now(timezone.utc).isoformat(),
            'baselineGeneration': index['generation'], 'scope': 'Every published scene with an effective zero point count in the baseline generation; unknown counts are excluded.',
            'reusePolicy': 'Confirmed scoped findings may be reused while revision, selected files, inventory hash and geometry evidence match evidenceKey. Recovered source/export checks are tied to their byte hashes and viewer implementation. Unresolved bindings, temporal selection and auxiliary containers are not absence confirmations.',
            'sourceNetworkReads': 0, 'sources': sources, 'scenes': scenes,
            'summary': {'scenes': len(scenes), 'sources': len(sources),
                        'findings': dict(sorted(Counter(row['finding'] for row in scenes).items())),
                        'recoveredPoints': sum(row.get('counts', {}).get('points', 0) for row in scenes)}}


def verified_frame_selection(exported, counts):
    selection = exported.get('frameSelection', {})
    indices = selection.get('indices')
    source = selection.get('sourceCounts', {})
    selected = exported.get('counts', {})
    return (exported.get('cameraSourceFramesChecked') == 'passed'
            and all(source.get(key) == counts[key] for key in ('cameras', 'images', 'points'))
            and isinstance(indices, list) and len(indices) == selected.get('images') == selected.get('cameras')
            and all(type(index) is int and 0 <= index < counts['images'] for index in indices)
            and len(set(indices)) == len(indices) and len(indices) > 0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', type=Path, default=Path('public/hub/datasets/individual/index.json'))
    parser.add_argument('--rows', type=Path, help='Complete baseline records JSON; otherwise read the generated packs')
    parser.add_argument('--prior', type=Path, default=Path('data/scene-component-audit.json.gz'))
    parser.add_argument('--exports', type=Path, help='Independently verified model exports')
    parser.add_argument('--confirmations', type=Path, help='Exact evidence-key-bound auxiliary inspection confirmations')
    parser.add_argument('--output', type=Path, default=Path('.tmp/zero-point-audit/report.json'))
    args = parser.parse_args()
    rows = read(args.rows) if args.rows else [row for file in (args.index.parent / 'packs').glob('*.json') for row in read(file)]
    report = audit(read(args.index), rows, read(args.prior), read(args.exports) if args.exports else [], read(args.confirmations) if args.confirmations else [])
    body = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(gzip.compress(body, mtime=0) if args.output.suffix == '.gz' else body)
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
