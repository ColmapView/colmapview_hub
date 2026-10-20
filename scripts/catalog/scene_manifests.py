"""Build explicit v1 scene manifests from offline, revision-bound load receipts.

No source downloads happen here or in the Worker. A different file selection
needs its own import, geometry and export evidence; native evidence stays intact.
"""

from copy import deepcopy
import hashlib
import json
import math
import posixpath
import re
from urllib.parse import quote

from .scene_contents import source_path
from .scene_qualification import scene_key, native_launch_manifest

ASSET_PREFIX = '/hub/datasets/individual/manifests/'
ASSET_BASE = 'https://colmapview.opsiclear.com' + ASSET_PREFIX
CHECKS = ('browserImport', 'visibleGeometry', 'cameraAlignment', 'modelExport',
          'independentColmapRead', 'cameraCalibration', 'cameraPoses', 'pointValues')
SELECTION_FIELDS = ('sourceId', 'revision', 'kind', 'path', 'files', 'modelFiles',
                    'points', 'photos', 'masks', 'maskRole', 'viewerState', 'counts', 'associationFiles',
                    'imagePrefix', 'sourceCounts', 'frameIndices', 'resizePolicy', 'pointAssociation')


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def selection_digest(review):
    return digest({key: review[key] for key in SELECTION_FIELDS if key in review})


def is_count(value, minimum=0):
    return type(value) is int and minimum <= value <= 2**53 - 1


def file_receipt(item):
    return (isinstance(item, dict) and source_path(item.get('sourcePath'))
            and is_count(item.get('bytes'), 1) and re.fullmatch('[a-f0-9]{64}', item.get('sha256', '')))


def validate_state(state, untracked):
    if (not isinstance(state, dict) or type(state.get('version')) is not int or state['version'] != 1 or not state.get('viewerVersion')
            or not isinstance(state.get('config'), dict)):
        raise ValueError('Manifest needs a valid saved viewer state')
    cloud = state['config'].get('pointCloud', {})
    if not isinstance(cloud, dict):
        raise ValueError('Manifest point settings must be an object')
    if untracked and (type(cloud.get('minTrackLength')) is not int or cloud['minTrackLength'] != 0
                      or cloud.get('showPointCloud') is not True):
        raise ValueError('Untracked manifest points must be visible with a zero track threshold')
    view = state.get('viewState')
    if (not isinstance(view, dict) or not all(isinstance(view.get(key), list) and len(view[key]) == length
            and all(type(value) in (int, float) and math.isfinite(value) for value in view[key])
            for key, length in [('position', 3), ('target', 3), ('quaternion', 4)])
            or not any(view['quaternion']) or type(view.get('distance')) not in (int, float)
            or not math.isfinite(view['distance']) or view['distance'] <= 0):
        raise ValueError('Manifest cloud needs a finite, checked overview')
    if 'transform' in state['config']:
        raise ValueError('A scene transform cannot establish companion-cloud alignment')


def validate_point_association(review):
    """A sibling cloud needs its own pinned world proof, never basename inference."""
    association = review.get('pointAssociation')
    if association is None:
        return False
    points = review.get('points') or {}
    root = association.get('sceneRoot') if isinstance(association, dict) else None
    if (review.get('kind') not in ('colmap', 'cameras') or points.get('format') not in ('xyz_ply', 'colmap_binary', 'colmap_text')
            or not source_path(root) or not source_path(points.get('sourcePath'))
            or not review['path'].startswith(root + '/') or not points['sourcePath'].startswith(root + '/')
            or posixpath.commonpath([review['path'], posixpath.dirname(points['sourcePath'])]) != root
            or review.get('checks', {}).get('pointAssociation') != 'passed'):
        raise ValueError('Sibling point association needs the exact common scene root and checked world proof')
    reference = association.get('referenceModel', {})
    if not isinstance(reference, dict):
        raise ValueError('Sibling point association needs reference model receipts')
    for role in ('cameras', 'images'):
        receipt = reference.get(role)
        if (not file_receipt(receipt) or posixpath.dirname(receipt['sourcePath']) != posixpath.dirname(points['sourcePath'])
                or posixpath.basename(receipt['sourcePath']) not in (role + '.bin', role + '.txt')):
            raise ValueError('Sibling point association needs the cloud model camera and pose byte receipts')
    method = association.get('method')
    if method != 'identical_native_model' and points['format'] != 'xyz_ply':
        raise ValueError('Native sibling tracks require identical camera and image identities')
    if method == 'identical_poses':
        delta = association.get('maxPoseDelta')
        if (not is_count(association.get('matchedImages'), 1)
                or association['matchedImages'] != review['counts']['images'] or type(delta) not in (int, float)
                or not math.isfinite(delta) or not 0 <= delta <= 1e-9):
            raise ValueError('Sibling point association must match every selected pose')
    elif method == 'identical_native_model':
        if (points['format'] not in ('colmap_binary', 'colmap_text')
                or not is_count(association.get('matchedImages'), 1)
                or association['matchedImages'] != review['counts']['images']
                or not is_count(association.get('matchedCameras'), 1)
                or association['matchedCameras'] != review['counts']['cameras']
                or type(association.get('maxPoseDelta')) not in (int, float)
                or not math.isfinite(association['maxPoseDelta']) or not 0 <= association['maxPoseDelta'] <= 1e-9
                or type(association.get('maxCalibrationDelta')) not in (int, float)
                or not math.isfinite(association['maxCalibrationDelta']) or not 0 <= association['maxCalibrationDelta'] <= 1e-9
                or association.get('identityIds') != 'matched' or type(association.get('sourceFeatures')) is not int
                or association['sourceFeatures'] != 0
                or any(review.get('checks', {}).get(key) != 'passed' for key in ('trackValues', 'sourceCameraIdentity'))):
            raise ValueError('Native sibling tracks require identical cameras, poses, IDs and an empty original feature table')
    elif method == 'publisher_shared_world':
        if (not file_receipt(association.get('declaration'))
                or not isinstance(association['declaration'].get('statement'), str)
                or not 10 <= len(association['declaration']['statement']) <= 2048
                or not is_count(association.get('matchedCameras'), 1)
                or association['matchedCameras'] != review['counts']['cameras']
                or type(association.get('maxCalibrationDelta')) not in (int, float)
                or association['maxCalibrationDelta'] != 0):
            raise ValueError('Sibling point association needs the pinned publisher declaration and identical calibration')
    else:
        raise ValueError('Unknown sibling point association method')
    return True


def manifest_scene_reviews(catalog, policy):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('scenes'), list) or not policy.get('checkedAt'):
        raise ValueError('Invalid scene manifest policy')
    entries = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for review in policy['scenes']:
        if not isinstance(review, dict):
            raise ValueError('Scene manifest receipt must be an object')
        entry = entries.get(review.get('sourceId'))
        revision = next((fact['value'] for fact in (entry or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if (not entry or entry.get('provider') != 'huggingface' or entry.get('access') != 'public'
                or revision != review.get('revision') or not re.fullmatch('[a-f0-9]{40}', revision or '')
                or review.get('kind') not in ('colmap', 'cameras', 'camera-scene') or review.get('archive')
                or review.get('path') != '' and not source_path(review.get('path'))):
            raise ValueError('Scene manifest source, revision or native model identity changed')
        if (not review.get('checkedAt') or not re.fullmatch('[a-f0-9]{40}', review.get('viewerCommit', ''))
                or not re.fullmatch(r'\d+\.\d+\.\d+', review.get('viewerVersion', ''))
                or not re.fullmatch('[a-f0-9]{64}', review.get('exportSha256', ''))
                or review.get('selectionSha256') != selection_digest(review)):
            raise ValueError('Scene manifest needs a dated viewer build and selection-bound export receipt')
        if any(review.get('checks', {}).get(key) != 'passed' for key in CHECKS):
            raise ValueError('Manifest import, alignment and independent export checks must pass')
        counts = review.get('counts', {})
        points = review.get('points')
        if not isinstance(counts, dict) or points is not None and not isinstance(points, dict):
            raise ValueError('Invalid manifest counts or points receipt')
        suffixes = {'xyz_ply': '.ply', 'colmap_binary': '.bin', 'colmap_text': '.txt', 'numpy_frame': '.npz'}
        if (not all(is_count(counts.get(key), 1) for key in ('cameras', 'images'))
                or not is_count(counts.get('points')) or (points is None and counts['points'] != 0)
                or (points is not None and (not file_receipt(points) or points.get('format') not in suffixes
                    or not points['sourcePath'].lower().endswith(suffixes[points['format']])
                    or points.get('count') != counts['points']))):
            raise ValueError('Manifest counts must describe the selected points and camera model')
        if not isinstance(review.get('files'), dict) or not all(source_path(value) for value in review['files'].values()):
            raise ValueError('Manifest must retain the original native file selection')
        if not isinstance(review.get('modelFiles'), dict):
            raise ValueError('Manifest needs camera and pose byte receipts')
        metadata = review['kind'] == 'camera-scene'
        for role in (('metadata',) if metadata else ('cameras', 'images')):
            item = review.get('modelFiles', {}).get(role, {})
            expected = [value for key, value in review['files'].items() if key.startswith('metadata:')] if metadata else [review['files'].get(role)]
            if not file_receipt(item) or item['sourcePath'] not in expected:
                raise ValueError('Manifest needs exact camera and pose byte receipts')
        if metadata:
            source = review.get('sourceCounts', {})
            indices = review.get('frameIndices')
            if (not isinstance(source, dict) or not all(is_count(source.get(key), 1) for key in ('cameras', 'images')) or source.get('points') != 0
                    or points is None or points['format'] not in ('xyz_ply', 'numpy_frame')
                    or (indices is None and any(counts[key] != source[key] for key in ('cameras', 'images')))
                    or (indices is not None and (not isinstance(indices, list) or len(indices) != counts['images']
                        or counts['cameras'] != counts['images']
                        or any(not is_count(index) or index >= source['images'] for index in indices)
                        or len(set(indices)) != len(indices)))):
                raise ValueError('Metadata manifests require original counts and an exact optional frame subset')
            if points['format'] == 'numpy_frame' and (not isinstance(points.get('array'), str)
                    or not re.fullmatch('[A-Za-z0-9_]+', points['array']) or not is_count(points.get('frame'))
                    or not indices or review.get('checks', {}).get('temporalAlignment') != 'passed'):
                raise ValueError('Temporal vertices need an explicit array, frame and independently aligned camera subset')
            transform = points.get('transform')
            if transform is not None and (not isinstance(transform, list) or len(transform) != 16
                    or any(type(value) not in (int, float) or not math.isfinite(value) for value in transform)
                    or transform[12:] != [0, 0, 0, 1] or review.get('checks', {}).get('worldTransform') != 'passed'):
                raise ValueError('Point transform requires a finite, independently verified cloud-to-camera-world matrix')
            if transform is not None and not file_receipt(review['modelFiles'].get('referenceCameras')):
                raise ValueError('Point transform requires original cloud-world camera byte receipts')
            resized = review.get('resizePolicy')
            if resized is not None and (not isinstance(resized, dict) or type(resized.get('factor')) is not int
                    or resized['factor'] not in (2, 4, 8, 16, 32, 64)
                    or resized.get('sourceMetadataSha256') != review['modelFiles']['metadata']['sha256']
                    or not all(is_count(resized.get(key), 1) for key in ('width', 'height', 'sourceWidth', 'sourceHeight'))
                    or not all(math.floor(resized['source' + key.title()] / resized['factor']) <= resized[key]
                        <= math.ceil(resized['source' + key.title()] / resized['factor']) for key in ('width', 'height'))):
                raise ValueError('Resized metadata requires an exact original receipt and checked power-of-two photograph dimensions')
        elif points:
            if points['format'] == 'numpy_frame':
                raise ValueError('Temporal vertices require a metadata camera manifest')
            if 'transform' in points:
                raise ValueError('Native manifests require points already aligned with their camera world')
        validate_point_association(review)
        if review.get('imagePrefix'):
            if metadata or review.get('photos'):
                raise ValueError('A native checked prefix cannot replace explicit metadata media')
            native_launch_manifest(entry, review, lambda *_: 'https://source.invalid/')
            sample = review['imagePrefix'].get('decodedSample')
            if sample is not None and (not file_receipt(sample) or sample['sourcePath'] != review['imagePrefix']['samplePath']
                    or not all(is_count(sample.get(key), 1) for key in ('width', 'height'))
                    or review.get('checks', {}).get('samplePhotoDecode') != 'passed'):
                raise ValueError('Decoded prefix sample needs exact full bytes, dimensions and browser evidence')
        names = {}
        for media_kind in ('photos', 'masks'):
            media = review.get(media_kind)
            if not isinstance(media, list):
                raise ValueError('Manifest media must be explicit')
            seen = set()
            for item in media:
                if not isinstance(item, dict):
                    raise ValueError('Manifest media receipt must be an object')
                name = item.get('name')
                if (not file_receipt(item) or not source_path(name) or name in seen
                        or not is_count(item.get('width'), 1) or not is_count(item.get('height'), 1)):
                    raise ValueError('Manifest media needs unique registered names, dimensions and byte receipts')
                seen.add(name)
                if media_kind == 'photos':
                    names[name] = (item['width'], item['height'])
                elif names.get(name) != (item['width'], item['height']):
                    raise ValueError('Manifest masks must bind checked photographs with matching dimensions')
            if media and review.get('checks', {}).get('photoDecode' if media_kind == 'photos' else 'maskDecode') != 'passed':
                raise ValueError('Manifest media pixels must be decoded')
        if review['photos'] and (len(review['photos']) > counts['images']
                or review.get('checks', {}).get('originalPhotoHashes') != 'passed'):
            raise ValueError('Manifest photographs must bind registered names and survive export unchanged')
        if review['masks'] and review.get('maskRole') not in ('unknown', 'foreground', 'validity'):
            raise ValueError('Manifest masks require an explicit role')
        for role, item in review.get('associationFiles', {}).items():
            if (role not in ('cameras', 'images') or not file_receipt(item)
                    or item['sha256'] != review['modelFiles'][role]['sha256']
                    or item['bytes'] != review['modelFiles'][role]['bytes']):
                raise ValueError('Peer photo association requires identical camera and pose files')
        if review.get('associationFiles') and set(review['associationFiles']) != {'cameras', 'images'}:
            raise ValueError('Peer photo association needs both camera and pose files')
        if not metadata:
            validate_state(review.get('viewerState'), bool(points and points['format'] == 'xyz_ply'))
        if not metadata and review['viewerState']['viewerVersion'] != review['viewerVersion']:
            raise ValueError('Manifest viewer build and saved state must agree')
        key = scene_key(review['sourceId'], review['kind'], review['path'])
        if key in reviews:
            raise ValueError('Duplicate scene manifest')
        reviews[key] = review
    return reviews


def manifest_assets(review, entry, hf_url):
    if review['kind'] == 'camera-scene':
        points = review['points']
        url = lambda path: hf_url(entry, review['revision'], path)
        cloud = {'url': url(points['sourcePath']), 'format': 'npz' if points['format'] == 'numpy_frame' else 'ply'}
        for key in ('array', 'frame', 'transform'):
            if key in points:
                cloud[key] = points[key]
        manifest = {'format': 'colmapview-camera-dataset', 'version': 1,
                    'metadataUrl': url(review['modelFiles']['metadata']['sourcePath']), 'pointCloud': cloud}
        if review.get('frameIndices'):
            manifest['frameIndices'] = review['frameIndices']
        return {review['selectionSha256'] + '.manifest.json': json_bytes(manifest)}
    state = json_bytes(review['viewerState'])
    state_name = hashlib.sha256(state).hexdigest() + '.state.json'
    url = lambda path: hf_url(entry, review['revision'], path)
    files = {role: url(review['files'][role]) for role in ('cameras', 'images')}
    if review.get('pointAssociation', {}).get('method') == 'identical_native_model':
        files['images'] = url(review['pointAssociation']['referenceModel']['images']['sourcePath'])
    if review['points'] is not None:
        files['points3D'] = url(review['points']['sourcePath'])
    for role in ('rigs', 'frames'):
        if role in review['files']:
            files[role] = url(review['files'][role])
    manifest = {'version': 1, 'name': review['path'] or review['sourceId'].removeprefix('hf:'), 'baseUrl': ASSET_BASE, 'files': files,
                'viewerStatePath': state_name, 'splats': [], 'skipImages': not bool(review['photos'])}
    if review['photos']:
        manifest['imageNameToPath'] = {item['name']: url(item['sourcePath']) for item in review['photos']}
    elif review.get('imagePrefix'):
        manifest['imagesPath'] = url(review['imagePrefix']['path'].rstrip('/')) + '/'
        manifest['skipImages'] = False
    if review['masks']:
        manifest['maskNameToPath'] = {item['name']: url(item['sourcePath']) for item in review['masks']}
        manifest['maskRole'] = review['maskRole']
    body = json_bytes(manifest)
    name = review['selectionSha256'] + '.manifest.json'
    if len(body) > 5 * 1024 * 1024 or len(state) > 256 * 1024:
        raise ValueError('Scene manifest or viewer state exceeds its bounded reader')
    return {name: body, state_name: state}


def apply_manifest_evidence(entry, row, revision, proof, review, hf_url):
    native = proof.get('sceneCompatibility') or proof.get('sceneValidation') or {}
    metadata = review['kind'] == 'camera-scene'
    original_counts = review.get('sourceCounts', review['counts']) if metadata else review['counts']
    if (row[0] != review['kind'] or row[3] or row[2] != review['files'] or revision != review['revision']
            or entry['sourceId'] != review['sourceId'] or row[1] != review['path']
            or any(native.get(key) != original_counts[key] for key in ('cameras', 'images'))):
        raise ValueError('Manifest must retain this exact native model and calibration')
    points = review['points']
    if metadata:
        if native.get('points') != 0 or (points['sourcePath'] not in row[2].values()
                and (points['format'] != 'numpy_frame' or posixpath.dirname(points['sourcePath']) != row[1])):
            raise ValueError('Metadata geometry must belong to this exact checked camera scene')
    elif points and points['format'] == 'xyz_ply':
        if (native.get('points') != 0 or points['sourcePath'] not in
                [value for role, value in row[2].items() if role.startswith('asset:')]
                and not validate_point_association(review)):
            raise ValueError('Manifest must supplement this exact empty native model with its checked companion')
    elif (native.get('points') != review['counts']['points']
            or points and points['sourcePath'] != row[2].get('points3d')):
        if (native.get('points') != 0 or review.get('pointAssociation', {}).get('method') != 'identical_native_model'
                or not validate_point_association(review)):
            raise ValueError('Manifest must preserve native points and observation IDs')
    if review['photos'] and proof.get('sourceImages', {}).get('status') == 'not_included':
        raise ValueError('Manifest photographs conflict with the publisher exclusion')
    if review.get('imagePrefix'):
        image = review['imagePrefix']
        audit = proof.get('photoAudit', {})
        if (proof.get('photoAvailability') not in ('sample_checked', 'complete_export_checked', 'partial')
                or any(image[key] != audit.get(value) for key, value in [('registeredName', 'sampleRegisteredName'),
                    ('samplePath', 'samplePath'), ('samplePrefixSha256', 'samplePrefixSha256')])):
            raise ValueError('Manifest prefix must preserve the exact previously checked native photographs')
    result = deepcopy(proof)
    if 'photoRouting' in result:
        result['priorPhotoRouting'] = result.pop('photoRouting')
    assets = manifest_assets(review, entry, hf_url)
    manifest_name = review['selectionSha256'] + '.manifest.json'
    manifest_url = ASSET_BASE + manifest_name
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(manifest_url, safe='')
    result.update({'checkedAt': review['checkedAt'], 'viewerVersion': review['viewerVersion'], 'delivery': 'browser_readable',
                   'statusLabel': 'Scene manifest verified',
                   'summary': f'{review["counts"]["images"]} registered poses and {review["counts"]["points"]:,} points loaded and exported through an explicit scene manifest.',
                   'scope': 'Exact pinned cameras, poses and selected points, with checked explicit media bindings. Native model evidence is retained separately.'})
    result['sceneManifest'] = {'url': manifest_url, 'sha256': hashlib.sha256(assets[manifest_name]).hexdigest(),
        'selectionSha256': review['selectionSha256'], 'counts': review['counts'],
        'pointSource': points['sourcePath'] if points else None, 'pointFormat': points['format'] if points else 'none',
        'photoCount': len(review['photos']), 'maskCount': len(review['masks']), 'maskRole': review.get('maskRole', 'unknown'),
        'exportSha256': review['exportSha256'], 'viewerCommit': review['viewerCommit'], 'viewerVersion': review['viewerVersion']}
    if review.get('pointAssociation'):
        result['sceneManifest']['pointAssociation'] = {key: review['pointAssociation'][key] for key in ('sceneRoot', 'method')}
    if review.get('imagePrefix', {}).get('decodedSample'):
        result['photoAudit'].update(samplePixels='decoded', sampleSha256=review['imagePrefix']['decodedSample']['sha256'])
    if metadata:
        result['sceneManifest']['sourceCounts'] = original_counts
        if review.get('frameIndices'):
            result['sceneManifest']['frameIndices'] = review['frameIndices']
            result['scope'] += ' The manifest selects one temporal frame and its matching photograph views; other times remain in the source metadata.'
            result['availableData']['cameras'] = {'status': 'checked', 'count': review['counts']['images']}
    data = result['availableData']
    if review['counts']['points']:
        data['point_cloud'] = {'status': 'checked', 'count': review['counts']['points'], 'samplePath': points['sourcePath']}
    if review['photos']:
        complete = len(review['photos']) == review['counts']['images']
        result['photoAvailability'] = 'complete_export_checked' if complete else 'partial'
        data['images'] = {'status': 'checked' if complete else 'partial', 'count': len(review['photos'])}
        photo_roots = [item['sourcePath'][:-len(item['name'])].rstrip('/') if item['sourcePath'].endswith(item['name'])
                       else posixpath.dirname(item['sourcePath']) for item in review['photos']]
        result['photoAudit'] = {'status': 'complete_export_checked' if complete else 'partial', 'checkedAt': review['checkedAt'], 'listingComplete': True,
            'policy': 'explicit_scene_manifest', 'sceneRoot': posixpath.commonpath(photo_roots),
            'summary': 'The explicitly bound photographs decoded at the camera resolution and survived export unchanged.',
            'policyNote': ('The current scene manifest binds these exact photographs to the selected camera and pose files.'
                + (' The peer photo folder has byte-identical camera and pose files; this association does not rely on matching basenames.'
                   if review.get('associationFiles') else '')),
            'nameCheck': {'registered': review['counts']['images'], 'matched': len(review['photos']),
                          'missing': review['counts']['images'] - len(review['photos']), 'ambiguous': 0},
            'samplePath': review['photos'][0]['sourcePath'], 'sampleBrowserRead': True, 'samplePixels': 'decoded'}
    elif not metadata and not review.get('imagePrefix'):
        if result.get('photoAvailability') in ('complete_export_checked', 'sample_checked', 'partial', 'path_policy_required'):
            result['photoAvailability'] = 'path_policy_required'
            data['images'] = {'status': 'needs_setup'}
            if result.get('photoAudit'):
                result['photoAudit'].update({'status': 'path_policy_required', 'checkedAt': review['checkedAt'],
                    'policy': 'explicit_scene_manifest_images_omitted',
                    'policyNote': 'The current manifest intentionally leaves known source photographs unbound.',
                    'nameCheck': {'registered': review['counts']['images'], 'matched': 0,
                                  'missing': review['counts']['images'], 'ambiguous': 0}})
        elif result.get('photoAvailability') != 'companion_archive':
            data.pop('images', None)
    if review['masks']:
        data['masks'] = {'status': 'checked', 'count': len(review['masks']), 'samplePath': review['masks'][0]['sourcePath']}
    # Available data describes the scene inventory. An intentionally narrow
    # manifest must not erase separately checked companion assets. Its selected
    # points/media remain recorded independently in sceneManifest above.
    return result, ('Camera metadata + selected vertices' if metadata else
                    'COLMAP + XYZ PLY' if points and points['format'] == 'xyz_ply' else 'COLMAP')
