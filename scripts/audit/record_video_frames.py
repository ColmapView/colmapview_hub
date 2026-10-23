"""Record prepared video mappings plus completed browser pixel receipts; no network reads."""

import argparse
from copy import deepcopy
import gzip
import json
import re
from pathlib import Path
import subprocess

from ..catalog.build_individual_catalog import hf_url
from ..catalog.photo_decisions import decision_digest, decision_records, selection_key
from ..catalog.scene_manifests import json_bytes, manifest_scene_reviews
from ..catalog.video_frames import CHECKS, review_digest, video_frame_reviews


def record(root, scratch, viewer):
    runtime_paths = ['src', 'public/wasm', 'public/workers', 'package.json', 'package-lock.json', 'vite.config.ts', 'viteVideoDecoderAsset.ts']
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', *runtime_paths], cwd=viewer, text=True)
    if dirty.strip():
        raise ValueError('Commit the exact checked viewer runtime before recording its audit')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=viewer, text=True).strip()
    version = json.loads((viewer / 'package.json').read_bytes())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or tuple(map(int, version.split('.'))) < (0, 21, 1):
        raise ValueError('Recheck the video frame runtime before changing this audit version')
    prepared = json.loads((scratch / 'prepared.json').read_bytes())
    samples = json.loads((scratch / 'video-pixels.json').read_bytes())['scenes']
    by_id = {sample['id']: sample for sample in samples}
    if (len(by_id) != len(samples) or set(by_id) != {scene['id'] for scene in prepared['scenes']}
            or any(sample['status'] != 'passed' for sample in samples)):
        raise ValueError('Every prepared scene needs its own passing browser frame receipt')
    reviews = []
    for scene in prepared['scenes']:
        sample = by_id[scene['id']]
        review = deepcopy(scene)
        review.update(checkedAt=sample['checkedAt'], viewerVersion=version, viewerCommit=commit,
                      sample=sample['sample'], checks={check: 'passed' for check in CHECKS})
        review['receiptSha256'] = review_digest(review)
        reviews.append(review)
    policy = {'schemaVersion': 1, 'checkedAt': max(review['checkedAt'] for review in reviews), 'scenes': reviews,
        'scope': 'Complete pinned registered-name/video/ordered-frame mapping and one decoded frame per scene. '
                 'Source video hashes are publisher LFS declarations. Other pixels and complete photo exports have separate evidence.'}
    catalog = json.loads((root / 'data/catalog.json').read_bytes())
    models = manifest_scene_reviews(catalog, json.loads((root / 'data/scene-manifests.json').read_bytes()))
    checked = video_frame_reviews(catalog, policy, models, hf_url)
    decisions_path = root / 'data/photo-audit-decisions.json.gz'
    decisions = json.loads(gzip.decompress(decisions_path.read_bytes()))
    records = decision_records(decisions)
    for key, review in checked.items():
        model = models[key]
        selection = selection_key(review['sourceId'], review['revision'], review['kind'], review['path'], model['files'])
        previous = records.get(selection)
        if not previous:
            raise ValueError('Video routing must retain its earlier pinned photo decision')
        evidence = [item for item in previous['evidence'] if item['kind'] != 'camera_video_frames']
        evidence.append({'kind': 'camera_video_frames', 'sha256': review['receiptSha256']})
        updated = {**previous, 'decision': 'automatic_video_frames', 'confirmed': True, 'checkedAt': review['checkedAt'],
            'scope': policy['scope'], 'nextAction': 'test_remaining_camera_pixels_or_complete_photo_export', 'evidence': evidence}
        updated['sha256'] = decision_digest(updated)
        decisions['scenes'][decisions['scenes'].index(previous)] = updated
    decisions['checkedAt'] = policy['checkedAt']
    decision_records(decisions)
    (root / 'data/video-frame-routing.json.gz').write_bytes(gzip.compress(json_bytes(policy), mtime=0))
    decisions_path.write_bytes(gzip.compress(json_bytes(decisions), mtime=0))
    print(f'Recorded {len(reviews)} scenes and {sum(len(review["videos"]) for review in reviews)} exact video bindings at {commit}.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--scratch', type=Path, default=Path('.tmp/camera-video-20261023'))
    parser.add_argument('--viewer-root', type=Path, required=True)
    args = parser.parse_args()
    record(args.root, args.scratch, args.viewer_root)
