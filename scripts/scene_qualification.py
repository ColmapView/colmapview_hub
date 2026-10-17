"""Exact, revision-bound evidence for publishing camera-and-photo scenes.

The offline research inventory is deliberately broader than the public Hub.
Listed files, readable headers and geometry-only imports cannot qualify a scene.
"""

import re
from urllib.parse import parse_qs, urlparse


REQUIRED_CHECKS = ('browserImport', 'photoExport', 'independentColmapRead',
                   'originalPhotoHashes', 'cameraCalibration', 'cameraPoses')


def scene_key(source_id, kind, path, archive=None):
    return source_id, kind, path, archive


def verified_scene_reviews(catalog, policy):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('scenes'), list):
        raise ValueError('Invalid verified scene policy')
    entries = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for review in policy['scenes']:
        entry = entries.get(review['sourceId'])
        revision = next((fact['value'] for fact in (entry or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if not entry or revision != review.get('revision') or not re.fullmatch('[a-f0-9]{40}', revision or ''):
            raise ValueError(f'Verified scene revision changed; recheck {review["sourceId"]}')
        counts = review.get('counts', {})
        photos = review.get('photos', [])
        if (any(type(counts.get(key)) is not int or counts[key] < 1 for key in ('cameras', 'images'))
                or type(counts.get('points')) is not int or counts['points'] < 0
                or len(photos) != counts['images']):
            raise ValueError('Verified scenes require cameras and all registered photographs')
        if any(review.get('checks', {}).get(key) != 'passed' for key in REQUIRED_CHECKS):
            raise ValueError('Verified scene import, original RGB export and independent COLMAP checks must pass')
        if (not review.get('checkedAt') or not review.get('viewerVersion')
                or not re.fullmatch('[a-f0-9]{40}', review.get('viewerCommit', ''))
                or not re.fullmatch('[a-f0-9]{64}', review.get('exportSha256', ''))):
            raise ValueError('Verified scene evidence requires a dated viewer build and export checksum')
        names = set()
        for photo in photos:
            if (not photo.get('name') or photo['name'] in names or not photo.get('sourcePath')
                    or type(photo.get('bytes')) is not int or photo['bytes'] < 1
                    or not re.fullmatch('[a-f0-9]{64}', photo.get('sha256', ''))):
                raise ValueError('Verified scene photographs require unique names and original byte hashes')
            names.add(photo['name'])
        key = scene_key(review['sourceId'], review['kind'], review['path'], review.get('archive'))
        if key in reviews:
            raise ValueError('Duplicate verified scene')
        reviews[key] = review
    return reviews


def qualified_evidence(entry, row, revision, review, hf_url):
    kind, path, files, archive = row
    if (entry.get('provider') != 'huggingface' or archive or kind not in ('colmap', 'cameras', 'camera-scene')
            or revision != review['revision'] or scene_key(entry['sourceId'], kind, path, archive)
            != scene_key(review['sourceId'], review['kind'], review['path'], review.get('archive'))):
        raise ValueError('Verified scene identity or supported layout changed; recheck the scene')
    required_files = review.get('files', {})
    if not required_files or any((files or {}).get(role) != value for role, value in required_files.items()):
        raise ValueError('Verified scene file paths changed; recheck the scene')
    load_path = review.get('loadPath')
    if kind in ('colmap', 'cameras'):
        if not all(role in required_files for role in ('cameras', 'images')) or (kind == 'colmap' and 'points3d' not in required_files):
            raise ValueError('Verified native scenes require the complete model file set')
        if load_path != path:
            raise ValueError('Verified native scene must launch its checked model folder')
    elif load_path not in [value for role, value in required_files.items() if role.startswith('metadata:')]:
        raise ValueError('Verified camera scene must launch its checked camera metadata')
    load_url = hf_url(entry, revision, load_path)
    viewer_url = review.get('viewerUrl', '')
    viewer = urlparse(viewer_url)
    if (viewer.scheme != 'https' or viewer.netloc != 'colmapview.opsiclear.com' or viewer.path != '/'
            or parse_qs(viewer.query) != {'url': [load_url]} or viewer.fragment):
        raise ValueError('Verified scene viewer target differs from its checked source')
    counts = review['counts']
    proof = {'level': 'scene_verified', 'delivery': 'browser_readable', 'checkedAt': review['checkedAt'],
             'statusLabel': 'Cameras + photos verified', 'viewerVersion': review['viewerVersion'], 'viewerUrl': viewer_url,
             'summary': f'{counts["images"]} posed original photographs and {counts["points"]:,} points loaded and exported as COLMAP + images. Independent checks matched original photo hashes, camera calibration and poses.',
             'scope': 'This exact scene and pinned revision. Other scenes, reconstruction variants and masks are not qualified by this check.',
             'sceneValidation': {'status': 'passed', 'revision': revision, 'images': counts['images'],
                                 'cameras': counts['cameras'], 'points': counts['points'], 'photoCount': len(review['photos']),
                                 'export': 'colmap_images', 'exportSha256': review['exportSha256']}}
    return proof, 'COLMAP + images' if kind in ('colmap', 'cameras') else 'Camera metadata + images (COLMAP export)'


def verified_source_entry(entry, proofs, formats):
    """Collection actions cannot inherit a different, unqualified asset sample."""
    result = {key: value for key, value in entry.items()
              if key not in ('viewerUrl', 'candidateViewerUrl', 'openUrl', 'modelManifest')}
    result['dataUrl'] = entry['sourceUrl']
    result['checkedAt'] = max(proof['checkedAt'] for proof in proofs)
    result['formats'] = sorted(set(formats))
    result['status'] = 'verified_scenes_available'
    result['statusLabel'] = 'Verified scenes available'
    scene_label = 'scene' if len(proofs) == 1 else 'scenes'
    result['description'] = f'{len(proofs)} named {scene_label} verified with cameras, original photographs and COLMAP + images export. Browse this collection’s published scenes to open them.'
    result['verification'] = {'level': 'verified_scenes_available', 'delivery': 'browser_readable',
                              'checkedAt': result['checkedAt'], 'viewerVersion': ', '.join(sorted({proof['viewerVersion'] for proof in proofs})),
                              'summary': result['description'],
                              'scope': 'Only the published named scenes are qualified. Historical collection samples do not qualify other scenes or masks.'}
    return result
