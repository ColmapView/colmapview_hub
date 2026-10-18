"""Exact, revision-bound compatibility and optional full-export evidence.

The offline research inventory is deliberately broader than the public Hub.
Native camera/pose models can qualify without photographs. Standalone geometry
cannot establish a scene. Full RGB export checks remain a stronger evidence tier.
"""

import re
from urllib.parse import parse_qs, quote, urlparse


REQUIRED_CHECKS = ('browserImport', 'photoExport', 'independentColmapRead',
                   'originalPhotoHashes', 'cameraCalibration', 'cameraPoses')


def scene_key(source_id, kind, path, archive=None):
    return source_id, kind, path, archive


def native_scene_reviews(catalog, policy):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('sources'), list):
        raise ValueError('Invalid native layout evidence')
    entries = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for source in policy['sources']:
        entry = entries.get(source['sourceId'])
        revision = next((fact['value'] for fact in (entry or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if not entry or revision != source.get('revision') or not re.fullmatch('[a-f0-9]{40}', revision or ''):
            raise ValueError(f'Native layout revision changed; recheck {source["sourceId"]}')
        for model in source['models']:
            # path, required files, camera count, registered pose count, points,
            # photo evidence, checked date. Original byte reads remain offline.
            path, files, cameras, poses, points, photos, checked_at, records = model
            if (not all(role in files for role in ('cameras', 'images', 'points3d'))
                    or any(value is not None and (type(value) is not int or value < 1) for value in (cameras, poses))
                    or points is not None and (type(points) is not int or points < 0)
                    or records.get('cameraRecordChecked') is not True or records.get('poseRecordChecked') is not True or not checked_at
                    or photos not in ('sample_checked', 'not_checked', 'unresolved')):
                raise ValueError('Native layout evidence requires camera/pose headers, exact model files and scoped photo evidence')
            key = scene_key(source['sourceId'], 'colmap', path)
            if key in reviews:
                raise ValueError('Duplicate native layout evidence')
            count_audit = records.get('countAudit')
            if count_audit is not None:
                if (not isinstance(count_audit, dict) or count_audit.get('method') != 'viewer_native_text_parse' or not count_audit.get('checkedAt')
                        or not isinstance(count_audit.get('files'), dict) or not count_audit['files']
                        or not set(count_audit['files']) <= {'cameras', 'images', 'points3d'}
                        or not re.fullmatch('[a-f0-9]{40}', count_audit.get('viewerCommit', ''))):
                    raise ValueError('Scene totals require a dated complete parse and viewer revision')
                for role, count in (('cameras', cameras), ('images', poses), ('points3d', points)):
                    if role not in count_audit['files']:
                        if count is not None and files[role].lower().endswith('.txt'):
                            raise ValueError('Known text totals require evidence for each complete file')
                        continue
                    evidence = count_audit['files'][role]
                    if (not isinstance(evidence, dict) or count is None or not files[role].lower().endswith('.txt')
                            or evidence.get('path') != files[role] or type(evidence.get('count')) is not int or evidence['count'] != count
                            or type(evidence.get('bytes')) is not int or evidence['bytes'] < 0
                            or not re.fullmatch('[a-f0-9]{64}', evidence.get('sha256', ''))):
                        raise ValueError('Scene totals must match the exact complete model files')
            reviews[key] = {'sourceId': source['sourceId'], 'revision': revision, 'path': path, 'files': dict(files),
                            'cameras': cameras, 'images': poses, 'points': points, 'photos': photos, 'checkedAt': checked_at,
                            **({'countAudit': count_audit} if count_audit else {})}
    return reviews


def native_evidence(entry, row, revision, review, hf_url):
    kind, path, files, archive = row
    if (entry.get('provider') != 'huggingface' or kind != 'colmap' or archive
            or entry['sourceId'] != review['sourceId'] or revision != review['revision'] or path != review['path']
            or any((files or {}).get(role) != value for role, value in review['files'].items())):
        raise ValueError('Native model identity or required file paths changed; recheck the scene')
    source_images = (entry.get('verification') or {}).get('sourceImages')
    photos = 'not_included' if source_images and source_images.get('status') == 'not_included' else review['photos']
    photo_summary = {'sample_checked': 'A matching original photograph passed a browser-read check; complete photo coverage is not established.',
                     'not_included': 'The publisher does not include the original photographs. Cameras and reconstruction remain usable.',
                     'not_checked': 'Original photograph availability is unverified; missing photographs do not prevent model loading.',
                     'unresolved': 'Sampled photograph paths are ambiguous; cameras and reconstruction remain usable.'}[photos]
    proof = {'level': 'native_layout_checked', 'delivery': 'cors_headers_checked', 'checkedAt': review['checkedAt'],
             'statusLabel': 'Native COLMAP layout checked', 'viewerVersion': '0.17.0',
             'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + quote(hf_url(entry, revision, path), safe=''),
             'summary': 'Native camera, registered pose and point-file headers checked. ' + photo_summary,
             'scope': 'Exact pinned model file set and bounded native headers. Required model byte responses and CORS headers were checked. Full parsing, rendering and complete export are separate checks.',
             'sceneCompatibility': {'status': 'native_headers_checked', 'revision': revision,
                                    'cameraRecordChecked': True, 'poseRecordChecked': True, 'cameras': review['cameras'],
                                    'images': review['images'], 'points': review['points'],
                                    **({'countAudit': review['countAudit']} if review.get('countAudit') else {})}, 'photoAvailability': photos}
    if source_images:
        proof['sourceImages'] = source_images
    return proof, 'COLMAP'


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
    if (entry.get('verification') or {}).get('sourceImages', {}).get('status') == 'not_included':
        raise ValueError('Complete source-photo evidence conflicts with the publisher RGB exclusion; retain model-only evidence instead')
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
             'photoAvailability': 'complete_export_checked',
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
    result['status'] = 'supported_scenes_available'
    result['statusLabel'] = 'Supported scenes available'
    scene_label = 'scene' if len(proofs) == 1 else 'scenes'
    result['description'] = f'{len(proofs)} named {scene_label} with supported camera/model layouts. Photograph availability and full-export checks are recorded separately for each scene. Browse the published scenes to open them.'
    result['verification'] = {'level': 'supported_scenes_available', 'delivery': 'browser_readable' if all(proof['delivery'] == 'browser_readable' for proof in proofs) else 'cors_headers_checked',
                              'checkedAt': result['checkedAt'], 'viewerVersion': ', '.join(sorted({proof['viewerVersion'] for proof in proofs})),
                              'summary': result['description'],
                              'scope': 'Only the published named scenes are qualified. Historical collection samples do not qualify other scenes or masks.'}
    return result
