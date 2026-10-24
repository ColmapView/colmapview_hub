"""Generic, selection-bound video imagery; geometry and export evidence stay separate."""

from copy import deepcopy
from datetime import datetime
import hashlib
import json
import math
import re
from urllib.parse import quote

from .scene_manifests import ASSET_BASE, file_receipt, json_bytes, manifest_assets, source_path
from .scene_qualification import native_launch_manifest, scene_key
from .video_frames import review_digest

CHECKS = ('nativeSelection', 'nameCoverage', 'sourceListing', 'presentationMapping', 'browserPixels')
MODEL_ROLES = ('cameras', 'images', 'points3d', 'rigs', 'frames')


def base_manifest(model, parent, hf_url):
    if 'selectionSha256' in model:
        return json.loads(manifest_assets(model, parent, hf_url)[model['selectionSha256'] + '.manifest.json'])
    original = native_launch_manifest(parent, model, hf_url)
    if original:
        for role in ('rigs', 'frames'):
            if role in model['files']:
                original['files'][role] = hf_url(parent, model['revision'], model['files'][role])
        return original
    files = {('points3D' if role == 'points3d' else role): hf_url(parent, model['revision'], path)
             for role, path in model['files'].items() if role in MODEL_ROLES}
    return {'version': 1, 'baseUrl': ASSET_BASE, 'files': files, 'skipImages': True, 'splats': []}


def mapping_reviews(catalog, policy, native_models, manifest_models, hf_url):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('scenes'), list):
        raise ValueError('Invalid video frame mapping policy')
    parents = {parent['sourceId']: parent for parent in catalog['entries']}
    result = {}
    integer = lambda value, minimum=0: type(value) is int and minimum <= value <= 9007199254740991
    finite = lambda value: type(value) in (int, float) and math.isfinite(value)
    for review in policy['scenes']:
        key = scene_key(review.get('sourceId'), review.get('kind'), review.get('path'))
        model = manifest_models.get(key) or native_models.get(key)
        parent = parents.get(review.get('sourceId'))
        if (not model or not parent or parent.get('access') != 'public' or key in result
                or review.get('revision') != model['revision'] or review.get('receiptSha256') != review_digest(review)
                or any(review.get('checks', {}).get(check) != 'passed' for check in CHECKS)
                or review.get('temporalScope') not in ('per_pose', 'synchronized')
                or review.get('manifestVersion') not in (4, 5)
                or not re.fullmatch('[a-f0-9]{40}', review.get('viewerCommit', ''))
                or not re.fullmatch(r'\d+\.\d+\.\d+', review.get('viewerVersion', ''))
                or tuple(map(int, review['viewerVersion'].split('.'))) < (0, 23, 0)):
            raise ValueError('Video mapping needs its pinned native selection, viewer build and complete checks')
        try:
            datetime.fromisoformat(review['checkedAt'].replace('Z', '+00:00'))
        except (KeyError, ValueError, AttributeError) as error:
            raise ValueError('Video mapping needs a check date') from error
        counts = model.get('counts') or {role: model[role] for role in ('cameras', 'images', 'points')}
        model_files = model.get('modelFiles') or {role: {'sourcePath': path} for role, path in model['files'].items()
                                                if role in MODEL_ROLES}
        receipts = review.get('modelFiles', {})
        if (set(receipts) != set(model_files) or any(not file_receipt(receipt)
                or receipt['sourcePath'] != model_files[role]['sourcePath']
                or 'sha256' in model_files[role] and receipt != model_files[role] for role, receipt in receipts.items())):
            raise ValueError('Video mapping model byte receipts must retain the exact selected native files')
        original = json_bytes(base_manifest(model, parent, hf_url))
        if review.get('baseManifestSha256') != hashlib.sha256(original).hexdigest():
            raise ValueError('Video mapping must preserve its exact base model manifest')
        registered = review.get('registeredImages', [])
        if not isinstance(registered, list) or len(registered) != counts['images']:
            raise ValueError('Video mapping needs the complete native registered-name inventory')
        names = {}
        for image in registered:
            name = image.get('name')
            if (not source_path(name) or name in names or not integer(image.get('cameraId'), 1)
                    or not integer(image.get('width'), 1) or not integer(image.get('height'), 1)
                    or image['width'] * image['height'] > 16000000):
                raise ValueError('Video mapping registered names need checked native calibration')
            names[name] = image
        if len({image['cameraId'] for image in registered}) > counts['cameras']:
            raise ValueError('Video mapping camera identities exceed the native selection')
        videos = {}
        source_paths = set()
        for video in review.get('videos', []):
            if (not isinstance(video.get('id'), str) or not video['id'] or video['id'] in videos
                    or not file_receipt(video) or not source_path(video['sourcePath']) or video['sourcePath'] in source_paths
                    or not integer(video.get('width'), 1) or not integer(video.get('height'), 1)
                    or video['width'] * video['height'] > 16000000
                    or not integer(video.get('frameCount'), 1) or video['frameCount'] > 250000
                    or not finite(video.get('duration')) or video['duration'] <= 0
                    or 'playbackRate' in video and (not finite(video['playbackRate']) or not 0.0625 <= video['playbackRate'] <= 120)):
                raise ValueError('Video mapping sources need pinned file sizes, frame counts and dimensions')
            videos[video['id']] = video
            source_paths.add(video['sourcePath'])
        bindings = {}
        for binding in review.get('bindings', []):
            image, video = names.get(binding.get('name')), videos.get(binding.get('video'))
            index, timestamp = binding.get('frameIndex'), binding.get('timestamp')
            if (not image or not video or binding['name'] in bindings
                    or sum(field in binding for field in ('frameIndex', 'timestamp')) != 1
                    or review['manifestVersion'] == 4 and 'frameIndex' in binding
                    or (index is None) == (timestamp is None)
                    or index is not None and (not integer(index) or index >= video['frameCount'])
                    or timestamp is not None and (not finite(timestamp) or not 0 <= timestamp < min(604800, video['duration']))
                    or (image['width'], image['height']) != (video['width'], video['height'])):
                raise ValueError('Every video binding needs one exact, in-range selector and matching calibration')
            bindings[binding['name']] = binding
        used = {binding['video'] for binding in bindings.values()}
        if not bindings or used != set(videos):
            raise ValueError('Video sources and mapped names must have explicit nonempty coverage')
        sampled = set()
        sample_names = set()
        for sample in review.get('samples', []):
            binding = bindings.get(sample.get('name'))
            if (not binding or sample.get('name') in sample_names or sample.get('video') != binding['video']
                    or any(sample.get(field) != binding.get(field) for field in ('frameIndex', 'timestamp'))
                    or not re.fullmatch('[a-f0-9]{64}', sample.get('sha256', ''))
                    or not re.fullmatch('[a-f0-9]{64}', sample.get('referenceSha256', ''))
                    or not finite(sample.get('maxPixelDifference')) or not 0 <= sample['maxPixelDifference'] <= 3
                    or not finite(sample.get('meanPixelDifference')) or not 0 <= sample['meanPixelDifference'] <= 0.75
                    or not integer(sample.get('bytes'), 1)
                    or not finite(sample.get('sourceTimestamp')) or sample['sourceTimestamp'] < 0
                    or sample['sourceTimestamp'] >= videos[binding['video']]['duration']):
                raise ValueError('Video mapping pixels need the exact selected frame and independent sample receipt')
            sampled.add(binding['video'])
            sample_names.add(sample['name'])
        if sampled != used:
            raise ValueError('Every mapped video source needs a checked pixel sample')
        result[key] = review
    return result


def mapping_assets(review, model, parent, hf_url):
    base = base_manifest(model, parent, hf_url)
    original = json_bytes(base)
    videos = {video['id']: video for video in review['videos']}
    manifest = deepcopy(base)
    manifest.update(version=review['manifestVersion'], videoImages={})
    manifest.pop('skipImages', None)
    for binding in review['bindings']:
        video = videos[binding['video']]
        manifest['videoImages'][binding['name']] = {
            'url': hf_url(parent, review['revision'], video['sourcePath']), 'bytes': video['bytes'],
            **{key: binding[key] for key in ('frameIndex', 'timestamp') if key in binding},
            **({'playbackRate': video['playbackRate']} if 'playbackRate' in video else {})}
    body = json_bytes(manifest)
    return {hashlib.sha256(original).hexdigest() + '.manifest.json': original,
            hashlib.sha256(body).hexdigest() + '.manifest.json': body}


def apply_mapping(proof, review, model, parent, hf_url):
    result = deepcopy(proof)
    assets = mapping_assets(review, model, parent, hf_url)
    name = next(name for name in assets if name != review['baseManifestSha256'] + '.manifest.json')
    url = ASSET_BASE + name
    count = len(review['bindings'])
    coverage = 'video_frames' if count == len(review['registeredImages']) else 'partial'
    if result.get('photoRouting') or result.get('photoArchiveRouting'):
        raise ValueError('Promote mixed archive/photo routing to a complete scene manifest before adding video mappings')
    result['videoFrameMapping'] = {'schemaVersion': 1, 'manifestVersion': review['manifestVersion'], 'url': url,
        'sha256': name.removesuffix('.manifest.json'), 'baseManifestSha256': review['baseManifestSha256'],
        'receiptSha256': review['receiptSha256'], 'revision': review['revision'],
        'modelFiles': {role: path for role, path in model['files'].items() if role in MODEL_ROLES},
        'registeredImages': len(review['registeredImages']), 'mappedImages': count, 'videoSources': len(review['videos']),
        'temporalScope': review['temporalScope'], 'checkedAt': review['checkedAt'],
        'viewerCommit': review['viewerCommit'], 'viewerVersion': review['viewerVersion'],
        'sampleCount': len(review['samples'])}
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(url, safe='')
    result['viewerVersion'] = review['viewerVersion']
    result['photoAvailability'] = coverage
    result['summary'] = (f'{count} registered views map to {len(review["videos"])} pinned source videos. '
                         'Derived-frame samples decoded at native camera resolution; other imagery retains its separate evidence.')
    result['scope'] += ' Video imagery has separate mapping/sample evidence; it does not establish feature integrity or complete photo-export verification.'
    result.setdefault('availableData', {})['images'] = {'status': 'listed', 'count': count, 'sourceFormat': 'video'}
    result['photoAudit'] = {'status': coverage, 'checkedAt': review['checkedAt'], 'listingComplete': True,
        'policy': 'explicit_video_frame_mapping', 'summary': result['summary'],
        'policyNote': 'One fixed frame per registered pose. Source videos are read on demand; only sampled pixels are independently checked.',
        'nameCheck': {'registered': len(review['registeredImages']), 'matched': count,
                      'missing': len(review['registeredImages']) - count, 'ambiguous': 0}}
    return result
