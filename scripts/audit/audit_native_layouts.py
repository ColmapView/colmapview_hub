"""Audit pinned native binary model headers before browser transport checks.

Reads bounded anonymous source ranges only. A passing header is not a full
model import, photograph inventory, or export qualification.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import threading

from .dataset_audit import CAMERA_MODELS, Network, colmap_header, now, source_url
from .prepare_individual_datasets import directory_listing, individual_records, read, write_pack


PREFIX_BYTES = 65536
MAX_CAMERA_BYTES = 8 * 1024 * 1024


def inspect_header(path, role, raw, source_bytes):
    result = colmap_header(path, raw, role)
    count = result['records']
    minimum = {'cameras': 24, 'images': 73, 'points3d': 51}[role]
    if source_bytes < 8 + count * minimum:
        raise ValueError('Declared records exceed the complete source size')
    if role == 'cameras':
        if len(raw) != source_bytes:
            raise ValueError('Camera calibration must be read completely')
        offset, cameras = 8, {}
        models = list(CAMERA_MODELS)
        for _ in range(count):
            camera_id, model, width, height = struct.unpack_from('<iiQQ', raw, offset)
            if not 0 <= model < len(models) or width < 1 or height < 1 or camera_id in cameras:
                raise ValueError('Invalid camera calibration record')
            params = struct.unpack_from('<' + 'd' * CAMERA_MODELS[models[model]], raw, offset + 24)
            if not all(math.isfinite(value) for value in params):
                raise ValueError('Nonfinite camera calibration')
            cameras[camera_id] = {'model': models[model], 'width': width, 'height': height}
            offset += 24 + 8 * len(params)
        if offset != len(raw):
            raise ValueError('Camera record count does not consume the source')
        result['calibrations'] = cameras
    elif role == 'images':
        end = raw.find(b'\0', 72)
        if end <= 72 or end + 9 > len(raw):
            raise ValueError('No complete first registered name/count')
        name = raw[72:end].decode('utf8')
        if (name.startswith('/') or '\\' in name or re.search(r'[?#\x00-\x1f]', name)
                or any(part in ('', '.', '..') for part in name.split('/'))):
            raise ValueError('Unsafe registered photograph name')
        observations = struct.unpack_from('<Q', raw, end + 1)[0]
        if end + 9 + observations * 24 > source_bytes:
            raise ValueError('First observation count exceeds the complete pose file')
        result['sample'] = {'name': name, 'cameraId': struct.unpack_from('<I', raw, 68)[0],
                            'imageId': struct.unpack_from('<I', raw, 8)[0], 'observations': observations}
    return result


def audit_listing(listing, scratch, workers=6, media=False):
    repo, revision = listing['id'], listing['revision']
    if (not re.fullmatch(r'[^/\s]+/[^/\s]+', repo) or not re.fullmatch('[a-f0-9]{40}', revision)
            or listing.get('modelWalkVersion') != 2 or listing.get('listingComplete') is not True):
        raise ValueError('A complete, pinned model-directory listing is required')
    network = Network()
    directory = scratch / 'prefixes'
    directory.mkdir(parents=True, exist_ok=True)
    omitted = set(listing['omittedMediaPaths'])
    progress, lock = [0], threading.Lock()

    def media_inventory(folder):
        cache = scratch / 'media-listings'
        cache.mkdir(exist_ok=True)
        target = cache / (hashlib.sha256((repo + '@' + revision + '/' + folder).encode()).hexdigest() + '.json.gz')
        if target.exists():
            cached = read(target)
            if (cached.get('id') == repo and cached.get('revision') == revision
                    and cached.get('path') == folder and cached.get('listingComplete') is True):
                return cached
        children, files, _, receipt = directory_listing(repo, revision, folder, network)
        if children:
            raise ValueError('Nested media folders require a separate explicit inventory')
        result = {'id': repo, 'revision': revision, 'path': folder, 'listingComplete': True,
                  'paths': sorted(files), 'receipt': receipt}
        write_pack(target, result)
        return result

    def prefix(path, role):
        metadata = listing['files'][path]
        size = metadata['size']
        if role == 'cameras' and size > MAX_CAMERA_BYTES:
            raise ValueError('Camera calibration exceeds the explicit 8 MiB audit budget')
        limit = max(PREFIX_BYTES, size) if role == 'cameras' else PREFIX_BYTES
        url = source_url(repo, revision, path)
        key = hashlib.sha256(url.encode()).hexdigest()
        payload, receipt = directory / (key + '.bin'), directory / (key + '.json')
        if payload.exists() and receipt.exists():
            item = json.loads(receipt.read_text(encoding='utf8'))
            raw = payload.read_bytes()
            if (item['sourceBytes'] == metadata['size'] and item['url'] == url
                    and item['sha256'] == hashlib.sha256(raw).hexdigest()):
                return {**item, **inspect_header(path, role, raw, metadata['size'])}
        raw, headers, status, truncated = network.fetch(url, limit=limit, range_header=f'bytes=0-{limit - 1}')
        expected = min(size, limit)
        if (truncated or len(raw) != expected or status not in (200, 206)
                or status == 200 and size > limit
                or status == 206 and headers.get('content-range') != f'bytes 0-{expected - 1}/{size}'):
            raise ValueError('Source did not return the exact bounded model range')
        if headers.get('access-control-allow-origin') not in ('*', 'https://colmapview.opsiclear.com'):
            raise ValueError('Required source CORS response is missing')
        digest = hashlib.sha256(raw).hexdigest()
        lfs_hash = metadata.get('lfs', {}).get('oid')
        if size == len(raw) and lfs_hash and digest != lfs_hash:
            raise ValueError('Complete model bytes disagree with their pinned LFS hash')
        item = {'path': path, 'url': url, 'bytes': len(raw), 'sourceBytes': size, 'sha256': digest,
                'httpStatus': status, 'entire': len(raw) == size,
                'sourceSha256': lfs_hash, 'cors': headers.get('access-control-allow-origin')}
        details = inspect_header(path, role, raw, size)
        payload.write_bytes(raw)
        receipt.write_text(json.dumps(item), encoding='utf8')
        return {**item, **details}

    def model(row):
        kind, path, files, archive = row
        result = {'kind': kind, 'path': path, 'files': files, 'archive': archive, 'errors': []}
        try:
            result['headers'] = {role: prefix(file, role) for role, file in files.items() if role in ('cameras', 'images', 'points3d')}
            headers = result['headers']
            sample = headers['images']['sample']
            camera = headers['cameras']['calibrations'].get(sample['cameraId']) or headers['cameras']['calibrations'].get(str(sample['cameraId']))
            if not camera:
                raise ValueError('Registered pose references an absent camera')
            result['sample'] = {**sample, 'width': camera['width'], 'height': camera['height']}
            for role, subdir in (('photo', 'images'), ('mask', 'masks')):
                folder = path + '/' + subdir if path else subdir
                if folder in omitted:
                    result[role] = {'prefix': folder, 'path': folder + '/' + sample['name'],
                                    'url': source_url(repo, revision, folder + '/' + sample['name'])}
                    if media:
                        result.setdefault('mediaInventory', {})[role] = media_inventory(folder)
        except Exception as error:
            result['errors'].append(str(error))
        with lock:
            progress[0] += 1
            if progress[0] % 25 == 0 or result['errors']:
                print(json.dumps({'completed': progress[0], 'path': path, 'errors': result['errors']}), flush=True)
        return result

    models = [row for row in individual_records(listing['paths']) if row[0] in ('colmap', 'cameras') and not row[3]]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(model, models))
    report = {'schemaVersion': 1, 'sourceId': 'hf:' + repo, 'revision': revision, 'checkedAt': now(),
              'scope': 'Complete model directory discovery; complete calibrations and bounded original pose/point prefixes. Browser access and full loading are separate checks.',
              'models': results}
    (scratch / 'plan.json').write_text(json.dumps(report, ensure_ascii=False), encoding='utf8')
    print(json.dumps({'models': len(results), 'passed': sum(not row['errors'] for row in results),
                      'failed': sum(bool(row['errors']) for row in results)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--listing', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--media', action='store_true', help='Also enumerate the exact photograph/mask directory metadata; no media bytes are read')
    args = parser.parse_args()
    if not 1 <= args.workers <= 8:
        raise ValueError('Use between one and eight bounded workers')
    args.scratch.mkdir(parents=True, exist_ok=True)
    audit_listing(read(args.listing), args.scratch, args.workers, args.media)


if __name__ == '__main__':
    main()
