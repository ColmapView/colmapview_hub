"""Publish revision-bound photo routing without upgrading scene/export evidence."""

from copy import deepcopy
import hashlib
import json
import re
from urllib.parse import quote, parse_qs, urlsplit

from .scene_contents import is_metadata_sidecar, source_path
from .scene_qualification import LAUNCH_ASSETS, scene_key


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def safe_photo(path):
    return (source_path(path) and not is_metadata_sidecar(path)
            and not re.search(r'[?#\x00-\x1f]', path)
            and path.lower().endswith(('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff')))


def selection_digest(review):
    return hashlib.sha256(json_bytes({key: value for key, value in review.items() if key != 'selectionSha256'})).hexdigest()


def routing_reviews(catalog, policy):
    if (policy.get('schemaVersion') != 1 or not policy.get('checkedAt')
            or not isinstance(policy.get('scenes'), list)
            or not re.fullmatch('[a-f0-9]{40}', policy.get('viewerCommit', ''))
            or not re.fullmatch(r'\d+\.\d+\.\d+', policy.get('viewerVersion', ''))):
        raise ValueError('Invalid photo routing policy')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for record in policy['scenes']:
        item = {**record, **{key: record.get(key, policy[key]) for key in ('viewerVersion', 'viewerCommit', 'checkedAt')}}
        if (not re.fullmatch('[a-f0-9]{40}', item.get('viewerCommit', ''))
                or not re.fullmatch(r'\d+\.\d+\.\d+', item.get('viewerVersion', '')) or not item.get('checkedAt')):
            raise ValueError('Each photo routing receipt must retain its viewer build and audit date')
        if item.get('selectionSha256') != selection_digest(item):
            raise ValueError('Photo routing evidence must be selection-bound; rerun the audit after edits')
        parent = parents.get(item.get('sourceId'))
        revision = next((fact['value'] for fact in (parent or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if (not parent or parent.get('provider') != 'huggingface' or parent.get('access') != 'public'
                or revision != item.get('revision') or not re.fullmatch('[a-f0-9]{40}', revision or '')
                or item.get('kind') not in ('colmap', 'cameras') or item.get('archive')
                or item.get('path') != '' and not source_path(item.get('path'))):
            raise ValueError('Photo routing must retain a public pinned native scene')
        files, photos, names = item.get('files'), item.get('photos'), item.get('nameToPath')
        if (not isinstance(files, dict) or not {'cameras', 'images'} <= files.keys()
                or any(not source_path(path) for path in files.values())
                or not isinstance(photos, list) or not photos or any(not safe_photo(path) for path in photos)
                or len(photos) != len(set(photos))
                or not isinstance(names, dict) or not names
                or any(not source_path(name) or path not in photos for name, path in names.items())):
            raise ValueError('Photo routing requires a unique physical inventory and exact name overrides')
        if item.get('scope') != '' and not source_path(item.get('scope')):
            raise ValueError('Photo routing requires an explicit safe media scope')
        masks = item.get('masks', [])
        if (not isinstance(masks, list) or any(not safe_photo(path) for path in masks)
                or len(masks) != len(set(masks)) or set(masks) & set(photos)):
            raise ValueError('Masks and photographs must have separate physical inventories')
        sample = item.get('sample', {})
        check = item.get('nameCheck', {})
        checks = item.get('checks', {})
        if (sample.get('path') not in photos or names.get(sample.get('name')) != sample['path']
                or not re.fullmatch('[a-f0-9]{64}', sample.get('sha256', ''))
                or not all(checks.get(key) is True for key in ('inventoryComplete', 'sampleDimensionsMatch', 'sampleBinding', 'manifestBinding', 'noSelectionPrompt'))
                or type(check.get('inspected')) is not int or check['inspected'] < 1
                or type(check.get('matched')) is not int or not 1 <= check['matched'] <= check['inspected']
                or type(check.get('ambiguous')) is not int or not 0 <= check['ambiguous'] <= check['inspected'] - check['matched']
                or type(check.get('complete')) is not bool
                or check.get('registered') is not None and (type(check['registered']) is not int or check['registered'] < check['inspected'])
                or check['complete'] != (check.get('registered') == check['inspected'])):
            raise ValueError('Photo routing requires sampled calibration and released-loader binding checks')
        mappings = item.get('mappingReceipts', [])
        if (not isinstance(mappings, list) or check['matched'] > len(names)
                or len(names) > check['matched'] and not mappings):
            raise ValueError('Uninspected name overrides require an authoritative source mapping')
        for receipt in mappings:
            path = receipt.get('path')
            if (not source_path(path) or receipt.get('kind') not in ('image_mapping_csv', 'armgs_mapping', 'armgs_manifest')
                    or receipt.get('url') != f"https://huggingface.co/datasets/{quote(item['sourceId'][3:], safe='/')}/resolve/{revision}/{quote(path, safe='/')}"
                    or not re.fullmatch('[a-f0-9]{64}', receipt.get('sha256', '')) or receipt.get('complete') is not True):
                raise ValueError('Source name mappings must be complete, hashed and pinned to this repository')
        for role in ('cameras', 'images'):
            receipt = item.get('modelReceipts', {}).get(role, {})
            if (receipt.get('path') != files[role] or type(receipt.get('bytes')) is not int or receipt['bytes'] < 1
                    or type(receipt.get('sourceBytes')) is not int or not receipt['bytes'] <= receipt['sourceBytes'] <= 2 ** 53 - 1
                    or not re.fullmatch('[a-f0-9]{64}', receipt.get('sha256', ''))
                    or type(receipt.get('entire')) is not bool or receipt['entire'] != (receipt['bytes'] == receipt['sourceBytes'])
                    or role == 'cameras' and receipt['entire'] is not True):
                raise ValueError('Photo routing requires exact model header receipts and complete calibration')
        if (not item.get('sourceViewerUrl') or any(type(sample.get(key)) is not int or sample[key] < 1 for key in ('width', 'height'))
                or parse_qs(urlsplit(item['sourceViewerUrl']).query).get('url', [''])[0].startswith(LAUNCH_ASSETS)):
            raise ValueError('Photo routing requires the original launch target')
        key = scene_key(item['sourceId'], item['kind'], item['path'])
        if key in reviews:
            raise ValueError('Duplicate photo routing scene')
        reviews[key] = item
    return reviews


def routing_asset(review, entry, hf_url):
    scope = review['scope']
    relative = lambda path: path[len(scope) + 1:] if scope and path.startswith(scope + '/') else path if not scope else hf_url(entry, review['revision'], path)
    manifest = {'version': 1, 'name': review['path'] or entry['title'],
                'baseUrl': hf_url(entry, review['revision'], scope).rstrip('/') + '/',
                'files': {role: hf_url(entry, review['revision'], review['files'][key]) for role, key in
                          [('cameras', 'cameras'), ('images', 'images'), ('points3D', 'points3d'), ('rigs', 'rigs'), ('frames', 'frames')]
                          if key in review['files']},
                'images': [relative(path) for path in review['photos']],
                'imageNameToPath': {name: relative(path) for name, path in review['nameToPath'].items()},
                'masks': [relative(path) for path in review.get('masks', [])]}
    # Splat discovery and optional settings keep their original scene scope.
    # This policy declares photos; it does not select new companion geometry.
    body = json_bytes(manifest)
    if len(body) > 5 * 1024 * 1024:
        raise ValueError('Photo routing manifest exceeds the viewer reader bound')
    name = hashlib.sha256(body).hexdigest() + '.manifest.json'
    return name, body


def apply_routing(entry, row, revision, proof, review, hf_url):
    if (row[0] != review['kind'] or row[1] != review['path'] or row[2] != review['files'] or row[3]
            or revision != review['revision'] or entry['sourceId'] != review['sourceId']
            or proof.get('viewerUrl') != review['sourceViewerUrl'] or proof.get('sceneManifest')
            or proof.get('sceneValidation') or proof.get('photoAvailability') not in ('sample_checked', 'partial', 'path_policy_required')):
        raise ValueError('Photo routing cannot replace a different model, launch or full-export selection')
    audit = proof.get('photoAudit', {})
    sample = review['sample']
    previous_names = audit.get('nameCheck', {})
    if previous_names.get('scope') != 'prefix' and previous_names.get('registered', 0) > review['nameCheck']['inspected']:
        raise ValueError('Photo routing cannot discard stronger registered-name evidence; inspect the complete metadata')
    thumbnail = proof.get('thumbnail')
    sample_matches = (thumbnail.get('sourceSha256') == sample['sha256']
                      and thumbnail.get('originalWidth') == sample['width']
                      and thumbnail.get('originalHeight') == sample['height']) if thumbnail else (
        audit.get('sampleSha256') == sample['sha256'] and audit.get('sampleWidth') == sample['width']
        and audit.get('sampleHeight') == sample['height'] and audit.get('samplePixels') == 'decoded'
        and audit.get('sampleDimensionsMatch') is True and audit.get('sampleRegisteredName') == sample['name'])
    if (audit.get('samplePath') != sample['path'] or not audit.get('sampleBrowserRead')
            or not sample_matches
            or proof.get('sceneCompatibility', {}).get('images') not in (None, review['nameCheck']['registered'])):
        raise ValueError('Photo routing must use this scene\'s checked photograph bytes')
    name, body = routing_asset(review, entry, hf_url)
    result = deepcopy(proof)
    url = LAUNCH_ASSETS + name
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(url, safe='')
    result['photoRouting'] = {'url': url, 'sha256': hashlib.sha256(body).hexdigest(),
        'listedPhotos': len(review['photos']), 'mappedNames': len(review['nameToPath']),
        'nameCheck': review['nameCheck'], 'checkedAt': review['checkedAt'],
        'viewerVersion': review['viewerVersion'], 'viewerCommit': review['viewerCommit']}
    check = review['nameCheck']
    result['photoAudit'].pop('proposedNameCheck', None)
    result['photoAudit']['sampleRegisteredName'] = sample['name']
    result['photoAudit']['sampleDimensionsMatch'] = True
    result['photoAudit']['nameCheck'] = {'registered': check['inspected'], 'matched': check['matched'],
        'missing': check['inspected'] - check['matched'] - check['ambiguous'], 'ambiguous': check['ambiguous'],
        **({} if check['complete'] else {'scope': 'prefix', 'totalRegistered': check['registered']})}
    if result['photoAvailability'] == 'path_policy_required' or check['matched'] < check['inspected']:
        result['photoAvailability'] = 'partial' if check['matched'] < check['inspected'] or proof['photoAvailability'] == 'partial' else 'sample_checked'
        result['photoAudit']['status'] = result['photoAvailability']
        result['photoAudit']['summary'] = 'An explicit pinned photo manifest is applied to this model. A registered photo and its calibration dimensions were checked; remaining photo bytes and full export are separate checks.'
        result['summary'] = result['photoAudit']['summary']
        result['availableData']['images'] = {**result['availableData'].get('images', {}),
            'status': 'partial' if result['photoAvailability'] == 'partial' else 'checked'}
    result['photoAudit']['policy'] = 'explicit_photo_manifest'
    result['photoAudit']['policyNote'] = ('The launch manifest declares this scene\'s pinned photograph inventory and exact checked name overrides. '
        'The released viewer binds the sampled photograph without a collection prompt. Remaining photo bytes, calibration/alignment and full export retain their separate evidence scopes.')
    if audit.get('policy') == 'authoritative_json_mapping_required':
        result['photoAudit']['policyNote'] += ' Publisher mapping: ' + audit.get('policyNote', '')
    elif audit.get('policy') in ('eth3d_sibling_photo_folder', 'authoritative_manifest_companion_images'):
        result['photoAudit']['policyNote'] += ' Pre-manifest photo audit (' + audit.get('checkedAt', '') + '): ' + audit.get('policyNote', '')
    return result


def routing_coverage(proof, kind, unresolved=''):
    target = parse_qs(urlsplit(proof.get('viewerUrl', '')).query).get('url', [''])[0]
    manifest = target if target.startswith(LAUNCH_ASSETS) else ''
    routing = proof.get('photoRouting', {})
    archive = proof.get('photoArchiveRouting', {})
    video = proof.get('videoFrameRouting', {})
    status = ('video_frames_manifest' if video else 'full_scene_manifest' if proof.get('sceneManifest') else 'photo_inventory_manifest' if routing
              else 'photo_archive_manifest' if archive
              else 'prefix_manifest' if manifest else 'companion_archive' if proof.get('photoAvailability') == 'companion_archive'
              else 'no_photo_association' if proof.get('photoAvailability') in ('not_found', 'not_included')
              else 'importer_route' if kind not in ('colmap', 'cameras') else 'native_discovery_or_review')
    return {'launchRouting': status, 'photoManifest': manifest, 'listedPhotos': routing.get('listedPhotos', ''),
        'videoFrames': video.get('count', ''), 'videoTimestamp': video.get('timestamp', ''),
        'boundNamesChecked': video.get('count', routing.get('nameCheck', {}).get('matched', '')),
        'inspectedRegisteredNames': video.get('count', routing.get('nameCheck', {}).get('inspected', '')),
        'allNamesInspected': True if video else routing.get('nameCheck', {}).get('complete', ''),
        'declaredMappingNames': video.get('count', routing.get('mappedNames', '')),
        'routingCheckedAt': video.get('checkedAt', routing.get('checkedAt', archive.get('checkedAt', ''))), 'routingNote': '' if video else unresolved,
        'archivePhotoLowerBound': archive.get('photoLowerBound', ''), 'archiveMemberSample': archive.get('sampleMemberPath', '')}


def routing_failures(catalog, policy):
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    result = {}
    for item in policy.get('failures', []):
        parent = parents.get(item.get('sourceId'))
        revision = next((fact['value'] for fact in (parent or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if (not parent or parent.get('provider') != 'huggingface' or parent.get('access') != 'public'
                or item.get('revision') != revision or item.get('kind') not in ('colmap', 'cameras')
                or item.get('path') != '' and not source_path(item.get('path'))
                or not isinstance(item.get('reason'), str) or not item['reason']
                or not isinstance(item.get('files'), dict) or not item.get('sourceViewerUrl')):
            raise ValueError('Unresolved photo routing must retain its exact pinned scene')
        key = scene_key(item['sourceId'], item['kind'], item['path'])
        if key in result:
            raise ValueError('Duplicate unresolved photo routing scene')
        result[key] = {**item, 'reason': item['reason'].removeprefix('Error: ')}
    return result
