"""Add reviewed video imagery without replacing the independently checked model receipt."""

from copy import deepcopy
import hashlib
import json
import re
from urllib.parse import quote

from .scene_manifests import ASSET_BASE, json_bytes, manifest_assets, file_receipt, is_count
from .scene_qualification import scene_key

CHECKS = ('nativeCalibration', 'completeNameMapping', 'sourceListing', 'orderedFrameMapping', 'samplePixels')

# This pinned README declares 30 fps capture, packaged as 1 fps videos. Playback
# restores capture speed; the independently checked still timestamps stay unchanged.
PLAYBACK_RATES = {('hf:nyuvideolab/danceNet3D', '5ecd1b71d0c13b176dbdbe358b940624759d678f',
                   '9d470c38d7784ecd3c81f81375adae5e515e2607dcce57ba72766c0baa5eec23'): 30}


def review_digest(review):
    return hashlib.sha256(json_bytes({key: value for key, value in review.items() if key != 'receiptSha256'})).hexdigest()


def video_frame_reviews(catalog, policy, models, hf_url):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('scenes'), list):
        raise ValueError('Invalid video frame policy')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    result = {}
    for review in policy['scenes']:
        key = scene_key(review.get('sourceId'), review.get('kind'), review.get('path'))
        model = models.get(key)
        parent = parents.get(review.get('sourceId'))
        if (key in result or not model or not parent or parent.get('provider') != 'huggingface' or parent.get('access') != 'public'
                or review.get('revision') != model['revision'] or review.get('modelFiles') != model['modelFiles']
                or review.get('id') != model['id'] or review.get('receiptSha256') != review_digest(review)
                or any(review.get('checks', {}).get(check) != 'passed' for check in CHECKS)
                or not review.get('checkedAt') or not re.fullmatch(r'\d+\.\d+\.\d+', review.get('viewerVersion', ''))
                or tuple(map(int, review['viewerVersion'].split('.'))) < (0, 21, 1)
                or not re.fullmatch('[a-f0-9]{40}', review.get('viewerCommit', ''))):
            raise ValueError('Video frames require their exact checked native selection and reproducible pixel receipt')
        frame = model.get('frameGeometry', {})
        root = frame.get('sequencePath', '')
        ids = review.get('frameIds', [])
        timestamp = review.get('timestamp')
        if (not frame or review.get('frame') != frame['frame'] or review.get('frameCount') != frame['frameCount']
                or review.get('sessionManifest') != frame['sessionManifest']
                or not isinstance(review.get('readme'), dict)
                or any(review['readme'].get(field) != frame['sourceReadme'][field] for field in ('sourcePath', 'bytes', 'sha256'))
                or not file_receipt(review.get('extractor')) or review['extractor']['sourcePath'] != 'video_to_images.py'
                or not isinstance(ids, list) or len(ids) != frame['frameCount'] or len(set(ids)) != len(ids)
                or not all(isinstance(value, str) and re.fullmatch(r'\d{7}', value) for value in ids)
                or review.get('framesPerSecond') != 1 or not is_count(timestamp) or timestamp >= len(ids) or ids[timestamp] != frame['frame']):
            raise ValueError('Video timestamp must select the same geometry through the ordered publisher frame IDs')
        base_name = model['selectionSha256'] + '.manifest.json'
        base = manifest_assets(model, parent, hf_url)[base_name]
        if review.get('baseManifest') != {'file': base_name, 'sha256': hashlib.sha256(base).hexdigest()}:
            raise ValueError('Video frame layer must preserve its exact model manifest bytes')
        listing = review.get('listing', {})
        expected_listing = (f'https://huggingface.co/api/datasets/{review["sourceId"][3:]}/tree/{review["revision"]}/'
                            f'{root}?recursive=false&expand=false&limit=1000')
        if (listing.get('url') != expected_listing or listing.get('complete') is not True or not is_count(listing.get('bytes'), 1)
                or not re.fullmatch('[a-f0-9]{64}', listing.get('sha256', ''))):
            raise ValueError('Video frame layer needs the complete pinned scene listing')
        videos = review.get('videos', [])
        if not isinstance(videos, list) or len(videos) != model['counts']['images']:
            raise ValueError('Every registered camera needs one exact video binding')
        names = set()
        for video in videos:
            name = video.get('name', '')
            if (not re.fullmatch(r'\d{4}\.png', name) or name in names
                    or video.get('sourcePath') != f'{root}/{root.split("/")[-1]}_{name[:-4]}.mp4'
                    or not is_count(video.get('bytes'), 1) or not re.fullmatch('[a-f0-9]{64}', video.get('sourceSha256', ''))
                    or video.get('timestamp') != timestamp or not is_count(video.get('width'), 1)
                    or not is_count(video.get('height'), 1) or video['width'] * video['height'] > 16000000):
                raise ValueError('Invalid exact registered-camera video binding')
            names.add(name)
        sample = review.get('sample', {})
        video = next((item for item in videos if item['name'] == sample.get('name')), None)
        if (not video or any(sample.get(field) != video[field] for field in ('sourcePath', 'timestamp', 'width', 'height'))
                or not is_count(sample.get('bytes'), 1) or not re.fullmatch('[a-f0-9]{64}', sample.get('sha256', ''))
                or sample.get('packetCount') != len(ids) or sample.get('averagePacketRate') != 1
                or sample.get('codec') != 'hevc' or sample.get('duration') != len(ids)):
            raise ValueError('Video frame sample must decode at the camera resolution and declared frame rate')
        result[key] = review
    return result


def video_frame_asset(review, model, parent, hf_url):
    base_name = review['baseManifest']['file']
    manifest = json.loads(manifest_assets(model, parent, hf_url)[base_name])
    manifest.update(version=4, videoImages={video['name']: {
        'url': hf_url(parent, review['revision'], video['sourcePath']), 'bytes': video['bytes'], 'timestamp': video['timestamp']}
        for video in review['videos']})
    rate = PLAYBACK_RATES.get((review['sourceId'], review['revision'], review['readme']['sha256']))
    if rate is not None:
        for binding in manifest['videoImages'].values():
            binding['playbackRate'] = rate
    manifest.pop('skipImages', None)
    body = json_bytes(manifest)
    return hashlib.sha256(body).hexdigest() + '.manifest.json', body


def video_frame_assets(review, model, parent, hf_url):
    name, body = video_frame_asset(review, model, parent, hf_url)
    manifest = json.loads(body)
    # Reproduce the original published bytes even when building into an empty directory.
    for binding in manifest['videoImages'].values():
        binding.pop('playbackRate', None)
    original = json_bytes(manifest)
    return {hashlib.sha256(original).hexdigest() + '.manifest.json': original, name: body}


def apply_video_frames(proof, review, model, parent, hf_url):
    result = deepcopy(proof)
    name, _ = video_frame_asset(review, model, parent, hf_url)
    url = ASSET_BASE + name
    sample = review['sample']
    result['videoFrameRouting'] = {'url': url, 'sha256': name.removesuffix('.manifest.json'),
        'baseManifestUrl': result['sceneManifest']['url'], 'baseManifestSha256': result['sceneManifest']['sha256'],
        'receiptSha256': review['receiptSha256'], 'count': len(review['videos']), 'timestamp': review['timestamp'],
        'frame': review['frame'], 'frameCount': review['frameCount'], 'checkedAt': review['checkedAt'],
        'viewerVersion': review['viewerVersion'], 'viewerCommit': review['viewerCommit'],
        'sample': {key: sample[key] for key in ('name', 'sourcePath', 'sha256', 'width', 'height')}}
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(url, safe='')
    result['viewerVersion'] = review['viewerVersion']
    result['checkedAt'] = review['checkedAt']
    result['statusLabel'] = 'Camera video frames available'
    result['photoAvailability'] = 'video_frames'
    result['scope'] = ('Exact pinned native cameras and selected geometry retain their independent model/export receipt. '
        'Every registered name is bound to its matching camera video and ordered frame ID. One frame per scene was decoded at the camera resolution; '
        'remaining camera pixels and full photo exports have separate checks. This launch shows one static time; sequence playback and archived masks are separate.')
    result['availableData']['images'] = {'status': 'listed', 'count': len(review['videos']), 'sourceFormat': 'video'}
    result['photoAudit'] = {'status': 'video_frames', 'checkedAt': review['checkedAt'], 'listingComplete': True,
        'policy': 'automatic_video_frames', 'sceneRoot': model['frameGeometry']['sequencePath'],
        'summary': f'{len(review["videos"])} camera videos are bound to selected frame {review["frame"]}. One matching frame decoded at the camera resolution.',
        'policyNote': 'Frames load on demand in the browser. Timestamps follow the ordered publisher frame list, including gaps. Original still photographs are not supplied.',
        'mappingFile': review['sessionManifest']['sourcePath'], 'samplePath': sample['sourcePath'],
        'sampleRegisteredName': sample['name'], 'sampleBrowserRead': True, 'samplePixels': 'decoded',
        'sampleWidth': sample['width'], 'sampleHeight': sample['height'], 'sampleDimensionsMatch': True,
        'nameCheck': {'registered': len(review['videos']), 'matched': len(review['videos']), 'missing': 0, 'ambiguous': 0}}
    return result
