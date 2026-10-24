"""Record a prepared generic mapping and independent browser pixel receipts offline."""

import argparse
from copy import deepcopy
import gzip
import json
from pathlib import Path
import re
import subprocess

from ..catalog.build_individual_catalog import hf_url
from ..catalog.photo_decisions import decision_digest, decision_records, selection_key
from ..catalog.scene_manifests import json_bytes, manifest_scene_reviews
from ..catalog.scene_qualification import native_scene_reviews, scene_key
from ..catalog.video_frame_mappings import CHECKS, mapping_reviews
from ..catalog.video_frames import review_digest


def checked_mapping(prepared, pixels, commit, version):
    """Only exact prepared samples can qualify a mapping; local paths never enter policy."""
    if (pixels.get('status') != 'passed' or pixels.get('viewerCommit') != commit
            or not pixels.get('checkedAt') or pixels.get('total') != len(prepared['samples'])):
        raise ValueError('Pixel receipts must identify the checked viewer and every prepared sample')
    references = {sample['name']: sample for sample in prepared['samples']}
    samples = pixels.get('samples', [])
    if len(references) != len(samples) or {sample.get('name') for sample in samples} != set(references):
        raise ValueError('Pixel receipts must cover the exact independent reference sample set')
    for sample in samples:
        reference = references[sample['name']]
        if (sample.get('status') != 'passed' or sample.get('referenceSha256') != reference['sha256']
                or any(sample.get(field) != reference.get(field) for field in ('video', 'frameIndex', 'timestamp', 'sourceTimestamp'))
                or sample.get('decodePath') != 'software' or sample.get('colorComparison') != 'unmanaged_rgba'):
            raise ValueError('Pixel receipt differs from its independently selected source frame')
    review = deepcopy(prepared)
    review['samples'] = [{key: sample[key] for key in ('name', 'video', 'frameIndex', 'timestamp', 'sourceTimestamp',
        'bytes', 'sha256', 'referenceSha256', 'maxPixelDifference', 'meanPixelDifference', 'width', 'height',
        'decodePath', 'colorComparison') if key in sample} for sample in samples]
    review.update(manifestVersion=5, checkedAt=pixels['checkedAt'], viewerCommit=commit, viewerVersion=version,
                  checks={check: 'passed' for check in CHECKS})
    review['receiptSha256'] = review_digest(review)
    return review


def record(root, scratch, viewer):
    runtime = ['src', 'public/wasm', 'public/workers', 'package.json', 'package-lock.json', 'vite.config.ts', 'viteVideoDecoderAsset.ts']
    if subprocess.check_output(['git', 'status', '--porcelain', '--', *runtime], cwd=viewer, text=True).strip():
        raise ValueError('Commit the exact checked viewer runtime before recording its audit')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=viewer, text=True).strip()
    version = json.loads((viewer / 'package.json').read_bytes())['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or tuple(map(int, version.split('.'))) < (0, 23, 0):
        raise ValueError('The mapping requires a checked v5 viewer runtime')
    review = checked_mapping(json.loads((scratch / 'prepared.json').read_bytes()),
                             json.loads((scratch / 'video-pixels.json').read_bytes()), commit, version)
    catalog = json.loads((root / 'data/catalog.json').read_bytes())
    native = native_scene_reviews(catalog, json.loads(gzip.decompress((root / 'data/native-layouts.json.gz').read_bytes())))
    manifests = manifest_scene_reviews(catalog, json.loads((root / 'data/scene-manifests.json').read_bytes()))
    policy_path = root / 'data/video-frame-mappings.json'
    policy = json.loads(policy_path.read_bytes())
    key = scene_key(review['sourceId'], review['kind'], review['path'])
    policy['scenes'] = [item for item in policy['scenes'] if scene_key(item['sourceId'], item['kind'], item['path']) != key] + [review]
    policy['checkedAt'] = max(item['checkedAt'] for item in policy['scenes'])
    policy['scope'] = ('Complete native-name/presentation-index mapping with independent software-decoded '
                       'RGBA samples per source, ignoring PNG display profiles. Other pixels, hardware color conversion '
                       'and complete photo exports have separate evidence. Video hashes are pinned publisher LFS declarations.')
    checked = mapping_reviews(catalog, policy, native, manifests, hf_url)
    model = manifests.get(key) or native[key]
    decisions_path = root / 'data/photo-audit-decisions.json.gz'
    decisions = json.loads(gzip.decompress(decisions_path.read_bytes()))
    records = decision_records(decisions)
    selection = selection_key(review['sourceId'], review['revision'], review['kind'], review['path'], model['files'])
    previous = records.get(selection)
    if not previous:
        raise ValueError('Retain the earlier selection-bound photo decision before adding imagery')
    evidence = [item for item in previous['evidence'] if item['kind'] != 'video_frame_mapping']
    evidence.append({'kind': 'video_frame_mapping', 'sha256': checked[key]['receiptSha256']})
    updated = {**previous, 'decision': 'automatic_video_frames', 'confirmed': True, 'checkedAt': review['checkedAt'],
        'scope': policy['scope'], 'nextAction': 'test_remaining_pixels_or_complete_photo_export', 'evidence': evidence}
    updated['sha256'] = decision_digest(updated)
    decisions['scenes'][decisions['scenes'].index(previous)] = updated
    decisions['checkedAt'] = max(decisions['checkedAt'], review['checkedAt'])
    decision_records(decisions)
    policy_path.write_bytes(json_bytes(policy))
    decisions_path.write_bytes(gzip.compress(json_bytes(decisions), mtime=0))
    print(f'Recorded {len(review["bindings"])} views from {len(review["videos"])} videos at {commit}.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--viewer-root', type=Path, required=True)
    args = parser.parse_args()
    record(args.root, args.scratch, args.viewer_root)
