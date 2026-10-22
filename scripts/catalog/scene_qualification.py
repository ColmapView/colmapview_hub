"""Exact, revision-bound compatibility and optional full-export evidence.

The offline research inventory is deliberately broader than the public Hub.
Native camera/pose models can qualify without photographs. Standalone geometry
cannot establish a scene. Full RGB export checks remain a stronger evidence tier.
"""

import hashlib
import json
import re
from urllib.parse import parse_qs, quote, urlparse


REQUIRED_CHECKS = ('browserImport', 'photoExport', 'independentColmapRead',
                   'originalPhotoHashes', 'cameraCalibration', 'cameraPoses')
MODEL_CHECKS = ('browserImport', 'modelExport', 'independentColmapRead', 'cameraCalibration', 'cameraPoses')
LAUNCH_ASSETS = 'https://colmapview.opsiclear.com/hub/datasets/individual/manifests/'


def native_launch_manifest(entry, review, hf_url):
    image = review.get('imagePrefix')
    skip_images = review.get('skipImages')
    if skip_images is not None and (skip_images is not True or image or review.get('photos') != 'unresolved'):
        raise ValueError('Skipping native photos requires an unresolved photo review without an image prefix')
    if not image and not skip_images:
        return None
    files = {role: hf_url(entry, review['revision'], review['files'][key])
             for role, key in [('cameras', 'cameras'), ('images', 'images'), ('points3D', 'points3d')] if key in review['files']}
    if skip_images:
        return {'version': 1, 'baseUrl': LAUNCH_ASSETS, 'files': files,
                'skipImages': True, 'images': [], 'masks': [], 'splats': []}
    if (not isinstance(image, dict) or not image.get('registeredName') or not image.get('samplePath')
            or not re.fullmatch('[a-f0-9]{64}', image.get('samplePrefixSha256', ''))
            or image.get('browserRead') is not True or image.get('dimensionsMatch') is not True
            or image.get('orientation') != 1):
        raise ValueError('Native image prefix requires an exact registered photo and calibration check')
    prefix = image.get('path')
    if (not isinstance(prefix, str) or prefix.startswith('/') or '\\' in prefix
            or any(part in ('', '.', '..') for part in prefix.rstrip('/').split('/'))
            or image['registeredName'].startswith('/') or '\\' in image['registeredName']
            or any(part in ('', '.', '..') for part in image['registeredName'].split('/'))
            or prefix.rstrip('/') + '/' + image['registeredName'] != image['samplePath']):
        raise ValueError('Native photo prefix does not preserve its registered image name')
    return {'version': 1, 'baseUrl': LAUNCH_ASSETS, 'files': files,
            'imagesPath': hf_url(entry, review['revision'], prefix.rstrip('/')) + '/', 'splats': []}


def launch_manifest_asset(manifest):
    body = json.dumps(manifest, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
    name = hashlib.sha256(body).hexdigest() + '.manifest.json'
    return name, body


def source_snapshot(receipts):
    rows = sorted((item['url'], item['bytes'], item['sha256']) for item in receipts)
    return hashlib.sha256(json.dumps(rows, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def public_launch_manifest(review):
    manifest = review.get('launchManifest')
    if manifest is None:
        return None
    files = review.get('files', {})
    expected = {role: files[key] for role, key in [('cameras', 'cameras'), ('images', 'images'), ('points3D', 'points3d')] if key in files}
    if (not isinstance(manifest, dict) or set(manifest) != {'version', 'baseUrl', 'files', 'imagesPath', 'splats'}
            or type(manifest.get('version')) is not int or manifest['version'] != 1 or manifest.get('baseUrl') != LAUNCH_ASSETS
            or not {'cameras', 'images'} <= expected.keys() or manifest.get('files') != expected
            or manifest.get('splats') != []):
        raise ValueError('Public launch manifest must select its exact reviewed native model')
    for url in [*expected.values(), manifest.get('imagesPath', '')]:
        parsed = urlparse(url)
        if parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.fragment:
            raise ValueError('Public native model and photo prefix must use explicit HTTPS URLs')
    name, body = launch_manifest_asset(manifest)
    if review.get('loadUrl') != LAUNCH_ASSETS + name or files.get('manifest') != LAUNCH_ASSETS + name:
        raise ValueError('Public native launch URL differs from its immutable manifest')
    receipt = next((item for item in review.get('sourceFiles', []) if item.get('path') == files['manifest']), {})
    if receipt.get('bytes') != len(body) or receipt.get('sha256') != hashlib.sha256(body).hexdigest():
        raise ValueError('Public launch manifest bytes differ from its receipt')
    return manifest


def checked_source_files(entry, review):
    receipts = review.get('sourceFiles', [])
    files = review.get('files')
    if not receipts or not isinstance(files, dict):
        raise ValueError('Model-only and public scenes require exact original-file byte and browser receipts')
    seen = set()
    for item in receipts:
        if (not isinstance(item, dict) or item.get('browserRead') is not True
                or type(item.get('bytes')) is not int or item['bytes'] < 1
                or not re.fullmatch('[a-f0-9]{64}', item.get('sha256', ''))
                or item.get('path') not in files.values() or item['path'] in seen):
            raise ValueError('Model-only and public scenes require exact original-file byte and browser receipts')
        seen.add(item['path'])
        if entry.get('provider') == 'public':
            expected = item['path']
        else:
            path = item['path']
            if (path.startswith('/') or '\\' in path or any(part in ('', '.', '..') for part in path.split('/'))):
                raise ValueError('Original-file receipts require exact safe source paths')
            expected = ('https://huggingface.co/datasets/' + quote(review['sourceId'][3:], safe='/')
                        + '/resolve/' + review['revision'] + '/' + quote(path, safe='/'))
        parsed = urlparse(item.get('url', ''))
        if (item.get('url') != expected or parsed.scheme != 'https' or not parsed.netloc
                or parsed.username or parsed.password or parsed.fragment):
            raise ValueError('Original-file receipt URL differs from its selected source')
    required = ({files[role] for role in ('cameras', 'images', 'points3d') if role in files}
                if review['kind'] in ('colmap', 'cameras') else {review.get('loadPath')})
    if review.get('companionPointCloud'):
        required.add(review['companionPointCloud'])
    if entry.get('provider') == 'public':
        required = {review.get('loadUrl')}
        if public_launch_manifest(review):
            required.update(files[role] for role in ('cameras', 'images', 'points3d') if role in files)
        if review.get('sourceSnapshotSha256') != source_snapshot(receipts):
            raise ValueError('Public scene source snapshot differs from its byte receipts')
        if len(review['revision']) == 64:
            if review['revision'] != review['sourceSnapshotSha256']:
                raise ValueError('Public snapshot revision differs from its original-file receipts')
        elif not all(review['revision'] in urlparse(item['url']).path.split('/') for item in receipts):
            raise ValueError('Public commit revision must appear in each original source URL')
    if not required <= seen:
        raise ValueError('Selected model or metadata is missing its original-file receipt')


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
            camera_only = 'points3d' not in files
            if (not all(role in files for role in ('cameras', 'images'))
                    or camera_only and (points != 0 or records.get('pointFileAbsentChecked') is not True)
                    or any(value is not None and (type(value) is not int or value < 1) for value in (cameras, poses))
                    or points is not None and (type(points) is not int or points < 0)
                    or records.get('cameraRecordChecked') is not True or records.get('poseRecordChecked') is not True or not checked_at
                    or photos not in ('sample_checked', 'not_checked', 'unresolved')):
                raise ValueError('Native layout evidence requires camera/pose headers, exact model files and scoped photo evidence')
            kind = 'cameras' if camera_only else 'colmap'
            if 'skipImages' in records and (records['skipImages'] is not True or records.get('imagePrefix') or photos != 'unresolved'):
                raise ValueError('Skipping native photos requires an unresolved photo review without an image prefix')
            key = scene_key(source['sourceId'], kind, path)
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
                    if role not in files:
                        if role in count_audit['files']:
                            raise ValueError('Absent native point files cannot have a file-count receipt')
                        continue
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
            calibration = records.get('calibrationReview')
            if calibration is not None:
                if (not isinstance(calibration, dict) or calibration.get('status') not in ('suspect', 'unverified')
                        or not isinstance(calibration.get('checkedAt'), str) or not calibration['checkedAt']
                        or not isinstance(calibration.get('summary'), str) or not 1 <= len(calibration['summary']) <= 1000
                        or not re.fullmatch('[a-f0-9]{64}', calibration.get('cameraFileSha256', ''))):
                    raise ValueError('Calibration review requires a dated, scoped note and exact camera file digest')
                camera_receipt = (count_audit or {}).get('files', {}).get('cameras')
                if camera_receipt and camera_receipt['sha256'] != calibration['cameraFileSha256']:
                    raise ValueError('Calibration review camera digest differs from the native file receipt')
            integrity = records.get('sourceIntegrityReview')
            if integrity is not None:
                if (not isinstance(integrity, dict) or integrity.get('status') != 'inconsistent'
                        or integrity.get('scope') not in ('complete_model', 'sampled_relationships')
                        or not isinstance(integrity.get('checkedAt'), str) or not integrity['checkedAt']
                        or not isinstance(integrity.get('summary'), str) or not 1 <= len(integrity['summary']) <= 1000
                        or not re.fullmatch('[a-f0-9]{64}', integrity.get('receiptSha256', ''))
                        or not isinstance(integrity.get('files'), dict) or set(integrity['files']) != {'images', 'points3d'}):
                    raise ValueError('Source integrity review requires dated, scoped relationship evidence and receipt digest')
                for role, evidence in integrity['files'].items():
                    if (not isinstance(evidence, dict) or role not in files or evidence.get('path') != files[role]
                            or not re.fullmatch('[a-f0-9]{64}', evidence.get('sha256', ''))
                            or type(evidence.get('bytes')) is not int or evidence['bytes'] < 1
                            or evidence.get('scope') != ('complete' if integrity['scope'] == 'complete_model' else 'prefix')):
                        raise ValueError('Source integrity review must identify the exact native files and read bounds')
            reviews[key] = {'sourceId': source['sourceId'], 'revision': revision, 'path': path, 'files': dict(files),
                            'cameras': cameras, 'images': poses, 'points': points, 'photos': photos, 'checkedAt': checked_at,
                            **({'kind': kind} if camera_only else {}),
                            **({'imagePrefix': records['imagePrefix']} if records.get('imagePrefix') else {}),
                            **({'skipImages': True} if records.get('skipImages') else {}),
                            **({'viewerVersion': records['viewerVersion']} if records.get('viewerVersion') else {}),
                            **({'countAudit': count_audit} if count_audit else {}),
                            **({'calibrationReview': dict(calibration)} if calibration else {}),
                            **({'sourceIntegrityReview': dict(integrity)} if integrity else {})}
    return reviews


def apply_calibration_review(proof, review):
    """Keep import/export evidence while exposing unresolved physical calibration."""
    return {**proof, 'calibrationReview': dict(review), 'statusLabel': 'Calibration needs review',
            'summary': review['summary'] + ' ' + proof['summary']}


def apply_source_integrity_review(proof, review):
    """Keep usable native geometry while making inconsistent feature links explicit."""
    return {**proof, 'sourceIntegrityReview': dict(review), 'statusLabel': 'Feature links need review',
            'summary': review['summary'] + ' ' + proof['summary']}


def native_evidence(entry, row, revision, review, hf_url):
    kind, path, files, archive = row
    if (entry.get('provider') != 'huggingface' or kind != review.get('kind', 'colmap') or archive
            or entry['sourceId'] != review['sourceId'] or revision != review['revision'] or path != review['path']
            or any((files or {}).get(role) != value for role, value in review['files'].items())):
        raise ValueError('Native model identity or required file paths changed; recheck the scene')
    source_images = (entry.get('verification') or {}).get('sourceImages')
    photos = 'not_included' if source_images and source_images.get('status') == 'not_included' else review['photos']
    photo_summary = {'sample_checked': 'A matching original photograph passed a browser-read check; complete photo coverage is not established.',
                     'not_included': 'The publisher does not include the original photographs. Cameras and reconstruction remain usable.',
                     'not_checked': 'Original photograph availability is unverified; missing photographs do not prevent model loading.',
                     'unresolved': 'Sampled photograph paths are ambiguous; cameras and reconstruction remain usable.'}[photos]
    camera_only = kind == 'cameras'
    model_summary = ('Native camera and registered pose headers checked; no native point file is supplied. ' if camera_only
                     else 'Native camera, registered pose and point-file headers checked. ')
    proof = {'level': 'native_layout_checked', 'delivery': 'cors_headers_checked', 'checkedAt': review['checkedAt'],
             'statusLabel': 'COLMAP cameras and poses checked' if camera_only else 'Native COLMAP layout checked', 'viewerVersion': review.get('viewerVersion', '0.17.0'),
             'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + quote(hf_url(entry, revision, path), safe=''),
             'summary': model_summary + photo_summary,
             'scope': 'Exact pinned model file set and bounded native headers. Required model byte responses and CORS headers were checked. Full parsing, rendering and complete export are separate checks.',
             'sceneCompatibility': {'status': 'native_headers_checked', 'revision': revision,
                                    'cameraRecordChecked': True, 'poseRecordChecked': True, 'cameras': review['cameras'],
                                    'images': review['images'], 'points': review['points'],
                                    **({'countAudit': review['countAudit']} if review.get('countAudit') else {})}, 'photoAvailability': photos}
    if source_images:
        proof['sourceImages'] = source_images
    manifest = native_launch_manifest(entry, review, hf_url)
    if manifest:
        name, _ = launch_manifest_asset(manifest)
        proof['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(LAUNCH_ASSETS + name, safe='')
    return proof, 'COLMAP cameras and poses' if camera_only else 'COLMAP'


def verified_scene_reviews(catalog, policy):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('scenes'), list):
        raise ValueError('Invalid verified scene policy')
    entries = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for review in policy['scenes']:
        entry = entries.get(review['sourceId'])
        revision = next((fact['value'] for fact in (entry or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if (not entry or revision != review.get('revision')
                or not re.fullmatch('[a-f0-9]{40}' if entry.get('provider') != 'public' else '[a-f0-9]{40}(?:[a-f0-9]{24})?', revision or '')):
            raise ValueError(f'Verified scene revision changed; recheck {review["sourceId"]}')
        counts = review.get('counts', {})
        photos = review.get('photos', [])
        export = review.get('export', 'colmap_images')
        if (any(type(counts.get(key)) is not int or counts[key] < 1 for key in ('cameras', 'images'))
                or type(counts.get('points')) is not int or counts['points'] < 0
                or export not in ('colmap_images', 'colmap_model')
                or export == 'colmap_images' and len(photos) != counts['images']
                or export == 'colmap_model' and photos):
            raise ValueError('Verified scenes require cameras and all registered photographs')
        if any(review.get('checks', {}).get(key) != 'passed' for key in (REQUIRED_CHECKS if export == 'colmap_images' else MODEL_CHECKS)):
            raise ValueError('Verified scene import, original RGB export and independent COLMAP checks must pass')
        if export == 'colmap_model' and counts['points'] and review.get('checks', {}).get('pointValues') != 'passed':
            raise ValueError('Nonempty model exports require independent point value and reference checks')
        cloud = review.get('companionPointCloud')
        if (cloud is not None or review['kind'] == 'camera-scene' and counts['points']):
            if (not isinstance(cloud, str) or not cloud.lower().endswith('.ply') or counts['points'] < 1
                    or cloud not in (review.get('files') or {}).values()
                    or review.get('checks', {}).get('pointValues') != 'passed'):
                raise ValueError('Companion points require the selected PLY, original byte receipt and independent point checks')
        if export == 'colmap_model' or entry.get('provider') == 'public' or cloud:
            checked_source_files(entry, review)
        frame_coverage = review.get('frameCoverage')
        if frame_coverage is not None and (not isinstance(frame_coverage, dict)
                or type(frame_coverage.get('metadataFrames')) is not int
                or type(frame_coverage.get('missingRgbFrames')) is not int or frame_coverage['missingRgbFrames'] < 1
                or frame_coverage['metadataFrames'] != counts['images'] + frame_coverage['missingRgbFrames']
                or not re.fullmatch('[a-f0-9]{64}', frame_coverage.get('listingSha256', ''))
                or frame_coverage.get('listingComplete') is not True or frame_coverage.get('listingBrowserRead') is not True
                or entry.get('provider') != 'huggingface'
                or not frame_coverage.get('listingUrl', '').startswith('https://huggingface.co/api/datasets/' + review['sourceId'][3:] + '/tree/' + revision + '/')):
            raise ValueError('Partial camera imports require exact frame and missing-photo coverage')
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
    export = review.get('export', 'colmap_images')
    if export == 'colmap_images' and (entry.get('verification') or {}).get('sourceImages', {}).get('status') == 'not_included':
        raise ValueError('Complete source-photo evidence conflicts with the publisher RGB exclusion; retain model-only evidence instead')
    kind, path, files, archive = row
    if (entry.get('provider') not in ('huggingface', 'public') or archive or kind not in ('colmap', 'cameras', 'camera-scene', 'scene')
            or revision != review['revision'] or scene_key(entry['sourceId'], kind, path, archive)
            != scene_key(review['sourceId'], review['kind'], review['path'], review.get('archive'))):
        raise ValueError('Verified scene identity or supported layout changed; recheck the scene')
    required_files = review.get('files', {})
    if not required_files or any((files or {}).get(role) != value for role, value in required_files.items()):
        raise ValueError('Verified scene file paths changed; recheck the scene')
    load_path = review.get('loadPath')
    if entry.get('provider') == 'public':
        load_url = review.get('loadUrl')
        parsed = urlparse(load_url or '')
        if (kind != 'scene' or load_url != entry.get('dataUrl') or load_url not in required_files.values()
                or parsed.scheme != 'https' or not parsed.netloc or parsed.username or parsed.password or parsed.fragment):
            raise ValueError('Public scene must launch its exact reviewed HTTPS source')
    elif kind in ('colmap', 'cameras'):
        if not all(role in required_files for role in ('cameras', 'images')) or (kind == 'colmap' and 'points3d' not in required_files):
            raise ValueError('Verified native scenes require the complete model file set')
        if load_path != path:
            raise ValueError('Verified native scene must launch its checked model folder')
    elif load_path not in [value for role, value in required_files.items() if role.startswith('metadata:')]:
        raise ValueError('Verified camera scene must launch its checked camera metadata')
    if entry.get('provider') == 'huggingface':
        load_url = hf_url(entry, revision, load_path)
    viewer_url = review.get('viewerUrl', '')
    viewer = urlparse(viewer_url)
    if (viewer.scheme != 'https' or viewer.netloc != 'colmapview.opsiclear.com' or viewer.path != '/'
            or parse_qs(viewer.query) != {'url': [load_url]} or viewer.fragment):
        raise ValueError('Verified scene viewer target differs from its checked source')
    counts = review['counts']
    model_only = export == 'colmap_model'
    proof = {'level': 'scene_verified', 'delivery': 'browser_readable', 'checkedAt': review['checkedAt'],
             'statusLabel': 'Camera model export checked' if model_only else 'Cameras + photos verified', 'viewerVersion': review['viewerVersion'], 'viewerUrl': viewer_url,
             'summary': (f'{counts["images"]} registered poses and {counts["points"]:,} points loaded and exported as a COLMAP model. Independent checks matched calibration and poses. Photograph availability is checked separately.' if model_only else f'{counts["images"]} posed original photographs and {counts["points"]:,} points loaded and exported as COLMAP + images. Independent checks matched original photo hashes, camera calibration and poses.'),
             'scope': ('This exact scene and pinned revision. Other scenes, reconstruction variants and masks are not qualified by this check.' if entry.get('provider') == 'huggingface' else 'This exact public source snapshot. Other scenes and masks require separate checks.'),
             'photoAvailability': 'not_checked' if model_only else 'complete_export_checked',
             'sceneValidation': {'status': 'passed', 'revision': revision, 'images': counts['images'],
                                 'cameras': counts['cameras'], 'points': counts['points'], 'photoCount': len(review['photos']),
                                 'export': export, 'exportSha256': review['exportSha256']}}
    if review.get('companionPointCloud'):
        proof['companionPointCloud'] = review['companionPointCloud']
        proof['scope'] += ' The selected XYZ PLY was compared point by point with the export in the saved camera world frame; feature observations are absent.'
    if review.get('frameCoverage'):
        coverage = review['frameCoverage']
        proof['scope'] += f' The metadata references {coverage["metadataFrames"]} frames; {coverage["missingRgbFrames"]} missing RGB references are omitted. Every exported pose was compared with its original source frame.'
    return proof, (('COLMAP model export' if review.get('launchManifest') else 'Camera metadata (COLMAP model export)') if model_only
                   else 'COLMAP + images' if kind in ('colmap', 'cameras') else 'Camera metadata + images (COLMAP export)')


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
