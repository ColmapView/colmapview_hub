"""Add reviewed Gaussian companions without changing a scene's native evidence."""

from copy import deepcopy
import hashlib
import re
from urllib.parse import parse_qs, quote, urlsplit, urljoin

from .photo_routing import json_bytes
from .scene_contents import source_path
from .scene_qualification import LAUNCH_ASSETS


def digest(value):
    return hashlib.sha256(json_bytes(value)).hexdigest()


def splat_asset(review):
    body = json_bytes(review['manifest'])
    if len(body) > 5 * 1024 * 1024:
        raise ValueError('Gaussian launch exceeds the manifest reader bound')
    return hashlib.sha256(body).hexdigest() + '.manifest.json', body


def splat_reviews(catalog, policy):
    if (policy.get('schemaVersion') != 1 or policy.get('viewerVersion') != '0.25.0'
            or not re.fullmatch('[a-f0-9]{40}', policy.get('viewerCommit', '')) or not policy.get('checkedAt')):
        raise ValueError('Invalid Gaussian routing policy')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for review in policy['routes']:
        parent = parents.get(review['sourceId'])
        revision = next((fact['value'] for fact in (parent or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if not parent or revision != review['revision'] or not re.fullmatch('[a-f0-9]{40}', revision or ''):
            raise ValueError('Gaussian source revision changed; re-audit the association')
        sealed = {key: value for key, value in review.items() if key != 'receiptSha256'}
        if review.get('receiptSha256') != digest(sealed) or review['id'] in reviews:
            raise ValueError('Invalid or duplicate Gaussian routing receipt')
        assets = review['assets']
        if not 1 <= len(assets) <= 1024 or len({asset['url'] for asset in assets}) != len(assets):
            raise ValueError('Gaussian alternatives must be distinct and bounded')
        for asset in assets:
            expected = f"https://huggingface.co/datasets/{quote(review['sourceId'][3:], safe='/')}/resolve/{revision}/{quote(asset['path'], safe='/')}"
            if (not source_path(asset['path']) or asset['url'] != expected
                    or asset['format'] not in ('ply', 'splat', 'sog') or not asset['path'].endswith('.' + asset['format'])
                    or asset['role'] not in ('model', 'change_subset') or not asset.get('association')
                    or any(type(asset.get(key)) is not int or not 1 <= asset[key] <= 2 ** 53 - 1 for key in ('bytes', 'gaussians', 'headerBytes'))
                    or asset['headerBytes'] > asset['bytes'] or not re.fullmatch('[a-f0-9]{64}', asset.get('headerSha256', ''))
                    or asset.get('allowOrigin') not in ('*', 'https://colmapview.opsiclear.com') or not asset.get('headerCheckedAt')):
                raise ValueError('Gaussian assets require pinned, counted and CORS-readable format receipts')
            if asset['association'] == 'sampled_identical_gaussian_positions':
                sample = asset.get('positionAssociation', {})
                if (sample.get('id') != review['id'] or sample.get('url') != asset['url'] or sample.get('matched', 0) < 32
                        or not source_path(sample.get('sourcePath'))
                        or sample.get('sourceUrl') != f"https://huggingface.co/datasets/{quote(review['sourceId'][3:], safe='/')}/resolve/{revision}/{quote(sample['sourcePath'], safe='/')}"
                        or not all(re.fullmatch('[a-f0-9]{64}', sample.get(key, '')) for key in ('referencePrefixSha256', 'alternatePrefixSha256'))):
                    raise ValueError('Alternate exports need counted identical-position fingerprints from this pinned scene')
        base = review['baseManifest']
        expected = deepcopy(base)
        if base.get('format') == 'colmapview-camera-dataset':
            if base.get('version') != 1:
                raise ValueError('Re-audit already extended camera manifests')
            expected['version'] = 2
        expected['splats'] = [asset['url'] for asset in assets]
        if review['manifest'] != expected or any(file.get('role') == 'splat' for file in base.get('geometryFiles', [])):
            raise ValueError('Gaussian routing can only add explicit companion sources')
        target = parse_qs(urlsplit(review['baseViewerUrl']).query).get('url', [''])[0]
        if not target:
            raise ValueError('Gaussian routing needs the exact original viewer target')
        base_hash = review.get('baseManifestSha256')
        if target.startswith(LAUNCH_ASSETS):
            if (not re.fullmatch('[a-f0-9]{64}', base_hash or '')
                    or not re.fullmatch(re.escape(LAUNCH_ASSETS) + r'[a-f0-9]{64}\.manifest\.json', target)):
                raise ValueError('Original immutable manifest digest differs')
            # Existing manifests use canonical JSON; preserve every base field.
            if digest(base) != base_hash:
                raise ValueError('Original manifest content differs')
        elif base.get('format') == 'colmapview-camera-dataset':
            if base.get('metadataUrl') != target:
                raise ValueError('Camera metadata selection changed')
        else:
            # Bare folders were resolved with the released viewer's discovery helper.
            # Require the exact selected native model, not a similarly named sibling.
            for role, source_role in [('cameras', 'cameras'), ('images', 'images'), ('points3D', 'points3d')]:
                path = (review.get('files') or {}).get(source_role)
                actual = urljoin(base.get('baseUrl', '').rstrip('/') + '/', base.get('files', {}).get(role, ''))
                if path and actual != f"https://huggingface.co/datasets/{review['sourceId'][3:]}/resolve/{revision}/{quote(path, safe='/')}":
                    raise ValueError('Discovered Gaussian launch changed the selected native model')
        reviews[review['id']] = {**review, 'checkedAt': policy['checkedAt'], 'viewerVersion': policy['viewerVersion'], 'viewerCommit': policy['viewerCommit']}
    return reviews


def apply_splats(entry, row, revision, proof, review):
    if (entry['sourceId'] != review['sourceId'] or revision != review['revision']
            or row[0] != review['kind'] or row[1] != review['path'] or row[2] != review['files'] or row[3]
            or proof.get('viewerUrl') != review['baseViewerUrl']):
        raise ValueError('Gaussian routing belongs to a different model selection or launch; re-audit')
    name, _ = splat_asset(review)
    url = LAUNCH_ASSETS + name
    evidence = {key: review[key] for key in ('sourceId', 'revision', 'kind', 'path', 'files', 'baseViewerUrl', 'assets', 'receiptSha256', 'checkedAt', 'viewerVersion', 'viewerCommit')}
    evidence.update(url=url, sha256=name.split('.')[0])
    result = deepcopy(proof)
    result['gaussianRouting'] = evidence
    result['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(url, safe='')
    result['availableData']['splats'] = {'status': 'checked', 'count': len(review['assets']), 'samplePath': review['assets'][0]['path']}
    return result
