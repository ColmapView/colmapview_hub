"""Apply offline, receipt-bound photo/model pair repairs without moving geometry."""

from copy import deepcopy
import hashlib
import json
import re
from urllib.parse import parse_qs, quote, urljoin, urlsplit

from .photo_routing import json_bytes
from .scene_qualification import LAUNCH_ASSETS, scene_key


def repair_reviews(catalog, policy, root):
    if policy.get('schemaVersion') != 1 or not isinstance(policy.get('repairs'), list):
        raise ValueError('Invalid source pair repair policy')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    result = {}
    for item in policy['repairs']:
        parent = parents.get(item.get('sourceId'), {})
        revision = next((fact['value'] for fact in parent.get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if (parent.get('access') != 'public' or parent.get('provider') != 'huggingface'
                or item.get('revision') != revision or not re.fullmatch('[a-f0-9]{40}', revision or '')
                or item.get('kind') != 'colmap'):
            raise ValueError('Source pair repair requires the exact public native selection')
        # Only committed operator files, never remote or caller-controlled paths.
        def read(path, prefix):
            if (not isinstance(path, str) or not path.startswith(prefix) or '\\' in path
                    or any(part in ('', '.', '..') for part in path.split('/')) or not path.endswith('.json')):
                raise ValueError('Unsafe source pair repair receipt path')
            return (root / path).read_bytes()
        raw = read(item.get('receipt'), 'data/')
        receipt = json.loads(raw)
        alternative = receipt.get('verifiedAlternative', {})
        if (hashlib.sha256(raw).hexdigest() != item.get('receiptSha256')
                or receipt.get('status') != 'photo_source_mismatch_confirmed'
                or any(receipt.get(key) != item.get(key) for key in ('sourceId', 'revision', 'path'))
                or not item.get('checkedAt') or not item.get('summary')
                or alternative.get('samePoses') != receipt.get('images', receipt.get('nativeReprojection', {}).get('images'))
                or alternative.get('sameSharedPoints') != receipt.get('nativeReprojection', {}).get('points')
                or alternative.get('maxSharedCoordinateDelta') != 0
                or alternative.get('browser', {}).get('uncaughtErrors') != []):
            raise ValueError('Source pair repair needs unchanged poses, points and browser evidence')
        manifest = json.loads(read(item.get('manifest'), 'docs/examples/'))
        photos = alternative.get('photos', {})
        coverage, samples = photos.get('coverage', []), photos.get('colorComparison', [])
        count = alternative['samePoses']
        if (len(coverage) != count or len({photo.get('name') for photo in coverage}) != count
                or len(samples) < 4 or any(sample.get('best', [{}])[0].get('dx') != 0
                    or sample.get('best', [{}])[0].get('dy') != 0 for sample in samples)
                or not {sample.get('name') for sample in samples} <= {photo.get('name') for photo in coverage}
                or any((photo.get('width'), photo.get('height')) != (samples[0]['width'], samples[0]['height']) for photo in coverage)):
            raise ValueError('Source pair repair needs complete name/dimension coverage and sampled pixel alignment')
        source = photos.get('sourceId', '')
        photo_revision = photos.get('revision', '')
        if not source.startswith('hf:') or not re.fullmatch('[a-f0-9]{40}', photo_revision):
            raise ValueError('Source pair archive must be revision pinned')
        archive_url = f'https://huggingface.co/datasets/{source[3:]}/resolve/{photo_revision}/{photos["archive"]}'
        archives = [{'url': archive_url, 'bytes': photos['bytes'], 'mountPath': 'images',
                     'stripPrefix': photos['stripPrefix'], 'role': 'images'}]
        files = alternative.get('files', {})
        model_root = f'https://huggingface.co/datasets/{item["sourceId"][3:]}/resolve/{revision}/'
        for role in ('cameras', 'images', 'points3D'):
            file = files.get(role, {})
            if (not re.fullmatch('[a-f0-9]{64}', file.get('sha256', ''))
                    or not isinstance(file.get('bytes'), int) or file['bytes'] < 1
                    or urljoin(manifest.get('baseUrl', ''), manifest.get('files', {}).get(role, '')) != model_root + file.get('sourcePath', '')):
                raise ValueError('Source pair manifest differs from its model byte receipts')
        if (manifest.get('version') != 2 or manifest.get('mediaArchives') != archives
                or set(manifest) != {'version', 'name', 'baseUrl', 'files', 'mediaArchives', 'splats'}
                or set(manifest['files']) != {'cameras', 'images', 'points3D'}
                or files['points3D']['sha256'] != receipt['files']['points3d']['sha256']
                or files['points3D']['sourcePath'] != item['files']['points3d']):
            raise ValueError('Source pair repair must retain native points and the checked photo archive')
        key = scene_key(item['sourceId'], item['kind'], item['path'])
        if key in result:
            raise ValueError('Duplicate source pair repair')
        body = json_bytes(manifest)
        sha = hashlib.sha256(body).hexdigest()
        result[key] = {**item, 'body': body, 'sha256': sha, 'url': LAUNCH_ASSETS + sha + '.manifest.json',
                       'photos': count, 'samples': len(samples), 'archiveUrl': archive_url}
    return result


def apply_repair(entry, row, revision, proof, review, assets):
    if (entry['sourceId'] != review['sourceId'] or revision != review['revision'] or row[3]
            or row[:3] != [review['kind'], review['path'], review['files']]
            or proof.get('viewerUrl') != review['originalViewerUrl']
            or proof.get('sceneManifest') or proof.get('sceneValidation')
            or proof.get('sourcePairRepair')):
        raise ValueError('Source pair repair belongs to a different native launch')
    original_url = parse_qs(urlsplit(review['originalViewerUrl']).query).get('url', [''])[0]
    if not original_url.startswith(LAUNCH_ASSETS):
        raise ValueError('Source pair repair requires an immutable original manifest')
    original = json.loads(assets[original_url.rsplit('/', 1)[-1]])
    repaired = json.loads(review['body'])
    if (original.get('splats') != repaired.get('splats')
            or urljoin(original['baseUrl'], original['files']['points3D']) != repaired['files']['points3D']
            or proof['sceneCompatibility']['images'] != review['photos']):
        raise ValueError('Source pair repair changed companions, points or pose count')
    result = deepcopy(proof)
    result['sourcePairRepair'] = {key: review[key] for key in
        ('sourceId', 'revision', 'kind', 'path', 'files', 'originalViewerUrl', 'url', 'sha256',
         'receiptSha256', 'checkedAt', 'photos', 'samples', 'archiveUrl')}
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(review['url'], safe='')
    result['statusLabel'] = 'Photo source corrected'
    result['summary'] = review['summary']
    # Prior native routing remains in the proof for validation; its old photo
    # calibration must not be presented as evidence for the replacement photos.
    result.pop('calibrationReview', None)
    result['availableData']['images'] = {'status': 'checked', 'count': review['photos']}
    return result
