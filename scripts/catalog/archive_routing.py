"""Attach checked scene-owned media archives without upgrading export evidence."""

from copy import deepcopy
import hashlib
import re
from urllib.parse import quote

from .photo_routing import json_bytes, selection_digest
from .scene_contents import source_path
from .scene_qualification import LAUNCH_ASSETS, scene_key


def archive_reviews(catalog, policy):
    if policy.get('schemaVersion') != 1 or not policy.get('checkedAt') or not isinstance(policy.get('scenes'), list):
        raise ValueError('Invalid companion archive routing policy')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    result = {}
    for item in policy['scenes']:
        parent = parents.get(item.get('sourceId'))
        revision = next((fact['value'] for fact in (parent or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        archive, sample = item.get('archive', {}), item.get('sample', {})
        version = item.get('viewerVersion', '')
        if (not parent or parent.get('provider') != 'huggingface' or parent.get('access') != 'public'
                or item.get('revision') != revision or re.fullmatch('[a-f0-9]{40}', revision or '') is None
                or item.get('kind') not in ('colmap', 'cameras') or item.get('selectionSha256') != selection_digest(item)
                or not source_path(item.get('path')) or not item.get('sourceViewerUrl')
                or not isinstance(item.get('files'), dict) or not {'cameras', 'images'} <= item['files'].keys()
                or any(not source_path(path) for path in item['files'].values())
                or re.fullmatch('[a-f0-9]{40}', item.get('viewerCommit', '')) is None
                or not isinstance(version, str) or re.fullmatch(r'\d+\.\d+\.\d+', version) is None
                or tuple(map(int, version.split('.'))) < (0, 19, 2) or not item.get('checkedAt')):
            raise ValueError('Companion routing requires the exact pinned native selection and viewer receipt')
        if (archive.get('format') not in ('zip', 'tar') or not source_path(archive.get('path'))
                or not archive['path'].lower().endswith('.' + archive['format'])
                or type(archive.get('bytes')) is not int or not 0 < archive['bytes'] <= 2 ** 53 - 1
                or not source_path(archive.get('mountPath'))
                or archive.get('stripPrefix', '') != '' and not source_path(archive.get('stripPrefix'))
                or type(archive.get('photosLowerBound')) is not int or archive['photosLowerBound'] < 1
                or not source_path(sample.get('memberPath')) or not source_path(sample.get('registeredName'))
                or not source_path(sample.get('mountedPath'))
                or re.fullmatch('[a-f0-9]{64}', sample.get('sha256', '')) is None
                or any(type(sample.get(key)) is not int or sample[key] < 1 for key in ('width', 'height'))
                or not all(item.get('checks', {}).get(key) is True for key in
                    ('nameSampleMatched', 'sampleDimensionsMatch', 'browserRangeRead', 'manifestBinding', 'modelSelectionPreserved'))):
            raise ValueError('Companion routing requires checked archive size, member, calibration and binding')
        index_bytes = archive.get('indexBytes')
        if index_bytes is not None and (archive['format'] != 'tar' or type(index_bytes) is not int
                or not 0 < index_bytes <= archive['bytes'] or index_bytes % 512
                or tuple(map(int, version.split('.'))) < (0, 20, 5)
                or item.get('checks', {}).get('prefixModelIdentity') is not True):
            raise ValueError('A selected TAR prefix requires a complete block boundary and checked matching model in a supported viewer')
        prefix = archive.get('stripPrefix', '')
        if prefix and not sample['memberPath'].startswith(prefix + '/'):
            raise ValueError('Archive sample is outside the stripped capture prefix')
        mounted = archive['mountPath'] + '/' + sample['memberPath'][len(prefix) + 1:] if prefix else archive['mountPath'] + '/' + sample['memberPath']
        if sample['mountedPath'] != mounted:
            raise ValueError('Archive sample mount changed')
        key = scene_key(item['sourceId'], item['kind'], item['path'])
        if key in result:
            raise ValueError('Duplicate companion archive routing')
        result[key] = item
    return result


def archive_asset(review, entry, hf_url):
    archive = review['archive']
    manifest = {'version': 2, 'name': review['path'],
        'baseUrl': hf_url(entry, review['revision'], review['path']).rstrip('/') + '/',
        'files': {role: hf_url(entry, review['revision'], review['files'][key]) for role, key in
            [('cameras', 'cameras'), ('images', 'images'), ('points3D', 'points3d'), ('rigs', 'rigs'), ('frames', 'frames')]
            if key in review['files']},
        'mediaArchives': [{'url': hf_url(entry, review['revision'], archive['path']), 'bytes': archive['bytes'],
            'mountPath': archive['mountPath'], 'stripPrefix': archive.get('stripPrefix', ''), 'role': 'images'}],
        'imageNameToPath': {review['sample']['registeredName']: review['sample']['mountedPath']}}
    if archive.get('indexBytes') is not None:
        manifest['mediaArchives'][0]['indexBytes'] = archive['indexBytes']
        manifest['splats'] = []
    body = json_bytes(manifest)
    return hashlib.sha256(body).hexdigest() + '.manifest.json', body


def apply_archive_routing(entry, row, revision, proof, review, hf_url):
    archive = proof.get('photoAudit', {}).get('archive', {})
    thumbnail, sample = proof.get('thumbnail', {}), review['sample']
    if (row[:3] != [review['kind'], review['path'], review['files']] or row[3]
            or revision != review['revision'] or proof.get('viewerUrl') != review['sourceViewerUrl']
            or proof.get('photoAvailability') != 'companion_archive' or archive.get('path') != review['archive']['path']
            or any(proof.get(key) for key in ('photoRouting', 'sceneManifest', 'sceneValidation'))
            or not archive.get('nameSampleMatched') or not archive.get('browserRangeRead')
            or archive.get('indexBytes') != review['archive'].get('indexBytes')
            or archive.get('format', 'zip') == 'tar' and archive.get('sample', {}).get('dimensionsMatch') is not True):
        raise ValueError('Companion routing cannot replace another model, archive, calibration or export')
    if thumbnail:
        sample_matches = (thumbnail.get('sourceArchive') == archive['path'] and thumbnail.get('sourceSha256') == sample['sha256']
                          and thumbnail.get('registeredName') == sample['registeredName']
                          and thumbnail.get('originalWidth') == sample['width'] and thumbnail.get('originalHeight') == sample['height'])
    else:
        original = archive.get('sample', {})
        sample_matches = (archive.get('format') == 'tar' and original.get('path') == sample['memberPath']
                          and original.get('registeredName') == sample['registeredName']
                          and original.get('sha256') == sample['sha256'] and original.get('pixels') == 'decoded'
                          and original.get('dimensionsMatch') is True
                          and original.get('width') == sample['width'] and original.get('height') == sample['height'])
    if not sample_matches:
        raise ValueError('Companion routing must retain the checked photograph bytes and calibration dimensions')
    name, body = archive_asset(review, entry, hf_url)
    result = deepcopy(proof)
    url = LAUNCH_ASSETS + name
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(url, safe='')
    result['photoArchiveRouting'] = {'url': url, 'sha256': hashlib.sha256(body).hexdigest(),
        'archivePath': review['archive']['path'], 'bytes': review['archive']['bytes'], 'format': review['archive']['format'],
        'photoLowerBound': review['archive']['photosLowerBound'], 'sampleRegisteredName': review['sample']['registeredName'],
        'sampleMemberPath': review['sample']['memberPath'], 'checkedAt': review['checkedAt'],
        'viewerVersion': review['viewerVersion'], 'viewerCommit': review['viewerCommit']}
    if review['archive'].get('indexBytes') is not None:
        result['photoArchiveRouting']['indexBytes'] = review['archive']['indexBytes']
    result['photoAudit']['policy'] = 'automatic_companion_archive'
    result['photoAudit']['summary'] = 'A version 2 manifest attaches this scene\'s own photo archive to the exact native model. A named photograph and its calibration were checked.'
    result['photoAudit']['policyNote'] = 'Archive members are indexed and read lazily. The sampled name, pixels and dimensions retain their original receipts; complete name/photo coverage and export remain separate checks.'
    if review['archive'].get('indexBytes') is not None:
        result['photoAudit']['policyNote'] += ' Only the complete selected first-frame prefix is indexed. Its source camera and pose metadata matches this model; later temporal frames stay outside the launch.'
    result['summary'] = ('Native model files and a registered photograph from the companion archive checked. '
        'The launch manifest attaches both; full photo coverage and export remain separate checks.')
    return result
