"""Prepare operator-reviewed scene content evidence and small public previews.

Run separately from builds: python prepare_scene_contents.py --plan PLAN.json.
The plan contains exact pinned scene identities, scoped mask paths, companion
model samples and a registered photo. Pillow is needed only for preparation.
No submitted URLs, private links or credentials are accepted. Deployment builds
only validate/copy these fixed assets and never download source data.
"""

import argparse
import concurrent.futures
import gzip
import hashlib
import io
import json
import re
import struct
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import warnings
import zipfile
import zlib
from collections import Counter
from pathlib import Path


MAX_PHOTO_BYTES = 24 * 1024 * 1024
MAX_HEADER_BYTES = 65536
GAUSSIAN = {'x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity',
            'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'}


def ply_content(body):
    text = body.decode('ascii', errors='replace').replace('\r\n', '\n')
    if not text.startswith('ply\n') or '\nend_header\n' not in text:
        return None
    header = text.split('\nend_header\n', 1)[0]
    vertex = re.search(r'^element vertex (\d+)$', header, re.M)
    if not vertex or int(vertex[1]) < 1:
        return None
    # Only vertex properties define splats; face/list properties do not.
    vertex_header = header[vertex.end():].split('\nelement ', 1)[0]
    properties = set(re.findall(r'^property \S+ (\w+)$', vertex_header, re.M))
    if GAUSSIAN <= properties:
        return 'splats'
    faces = re.search(r'^element face (\d+)$', header, re.M)
    if faces and int(faces[1]) > 0:
        return 'meshes'
    return 'point_cloud' if {'x', 'y', 'z'} <= properties else None


def pinned_url(url, row):
    parsed = urllib.parse.urlsplit(url)
    expected = '/datasets/' + row['sourceId'][3:] + '/resolve/' + row['revision'] + '/'
    if (parsed.scheme != 'https' or parsed.netloc != 'huggingface.co' or parsed.query or parsed.fragment
            or not row['sourceId'].startswith('hf:') or not re.fullmatch('[a-f0-9]{40}', row['revision'])
            or not urllib.parse.unquote(parsed.path).startswith(expected)):
        raise ValueError('Only an exact public revision-pinned source URL is allowed')


class Network:
    def __init__(self, cache):
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.next_request = 0.0

    def get(self, url, start=None, length=None):
        key = hashlib.sha256(json.dumps([url, start, length]).encode()).hexdigest()
        cached = self.cache / (key + '.bin')
        if cached.exists():
            body = cached.read_bytes()
            if len(body) > (length or MAX_PHOTO_BYTES):
                raise ValueError('Cached source exceeds byte bound')
            return body
        for attempt in range(3):
            with self.lock:
                delay = max(0, self.next_request - time.monotonic())
                self.next_request = max(time.monotonic(), self.next_request) + .14
            if delay:
                time.sleep(delay)
            headers = {'User-Agent': 'ColmapView-public-catalog-preview/1', 'Origin': 'https://colmapview.opsiclear.com'}
            if start is not None:
                headers['Range'] = f'bytes={start}-{start + length - 1}'
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=40) as response:
                    if start is not None:
                        content_range = response.headers.get('Content-Range', '')
                        match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', content_range)
                        if response.status == 206:
                            if not match or int(match[1]) != start or int(match[2]) >= start + length:
                                raise ValueError('Incorrect source byte range')
                        elif start != 0:
                            raise ValueError('Source does not honor archive byte ranges')
                    body = response.read((length or MAX_PHOTO_BYTES) + 1)
                    if len(body) > (length or MAX_PHOTO_BYTES):
                        if start == 0 and length == MAX_HEADER_BYTES:
                            body = body[:length]
                        else:
                            raise ValueError('Source exceeds byte bound')
                    if start is not None and response.status == 206 and len(body) != int(match[2]) - start + 1:
                        raise ValueError('Truncated source byte range')
                temporary = cached.with_suffix(f'.{threading.get_ident()}.tmp')
                temporary.write_bytes(body)
                temporary.replace(cached)
                return body
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                if isinstance(error, urllib.error.HTTPError) and error.code not in (429, 500, 502, 503, 504):
                    raise
                if attempt == 2:
                    raise
                time.sleep(2 ** attempt * 2)
        raise RuntimeError('Source read failed')


class ArchiveReader(io.RawIOBase):
    def __init__(self, network, url, size):
        self.network, self.url, self.size, self.position = network, url, size, 0
        self.tail_start = max(0, size - 65557)
        self.tail = network.get(url, self.tail_start, size - self.tail_start)
        if len(self.tail) != size - self.tail_start:
            raise ValueError('Archive size changed')

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        position = offset if whence == io.SEEK_SET else self.position + offset if whence == io.SEEK_CUR else self.size + offset
        if not 0 <= position <= self.size:
            raise ValueError('Archive seek outside source')
        self.position = position
        return position

    def read(self, length=-1):
        length = self.size - self.position if length < 0 else min(length, self.size - self.position)
        if length > MAX_PHOTO_BYTES:
            raise ValueError('Archive metadata exceeds bound')
        if not length:
            return b''
        start = self.position
        self.position += length
        if start >= self.tail_start:
            return self.tail[start - self.tail_start:start - self.tail_start + length]
        result = self.network.get(self.url, start, length)
        if len(result) != length:
            raise ValueError('Archive range length changed')
        return result


def archive_photo(network, target):
    reader = ArchiveReader(network, target['url'], target['archiveBytes'])
    with zipfile.ZipFile(reader) as archive:
        info = archive.getinfo(target['sourcePath'])
        if info.flag_bits & 1 or not 0 < info.file_size <= MAX_PHOTO_BYTES or not 0 < info.compress_size <= MAX_PHOTO_BYTES:
            raise ValueError('Encrypted or oversized photo member')
        reader.seek(info.header_offset)
        header = reader.read(30)
        if len(header) != 30 or header[:4] != b'PK\x03\x04':
            raise ValueError('Invalid ZIP photo header')
        name_length, extra_length = struct.unpack_from('<HH', header, 26)
        start = info.header_offset + 30 + name_length + extra_length
        if start + info.compress_size > reader.size:
            raise ValueError('ZIP member outside archive')
        body = network.get(target['url'], start, info.compress_size)
        if info.compress_type == zipfile.ZIP_DEFLATED:
            decoder = zlib.decompressobj(-15)
            photo = decoder.decompress(body, MAX_PHOTO_BYTES + 1)
            if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
                raise ValueError('Incomplete or oversized compressed photo')
        elif info.compress_type == zipfile.ZIP_STORED:
            photo = body
        else:
            raise ValueError('Unsupported photo compression')
        if len(photo) != info.file_size or zlib.crc32(photo) != info.CRC:
            raise ValueError('Photo member CRC or size mismatch')
        return photo


def square_preview(body):
    from PIL import Image, ImageOps
    Image.MAX_IMAGE_PIXELS = 75_000_000
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(body)) as source:
            original = source.size
            source = ImageOps.exif_transpose(source)
            source.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            if source.mode in ('RGBA', 'LA', 'P'):
                rgba = source.convert('RGBA')
                rgb = Image.new('RGB', rgba.size, 'white')
                rgb.paste(rgba, mask=rgba.getchannel('A'))
                source = rgb
            else:
                source = source.convert('RGB')
            preview = ImageOps.fit(source, (320, 320), Image.Resampling.LANCZOS, centering=(.5, .5))
            output = io.BytesIO()
            preview.save(output, format='JPEG', quality=80, optimize=True)
    if len(output.getvalue()) > 65536:
        raise ValueError('Preview exceeds 64 KiB')
    return output.getvalue(), original


def prepare(plan, root, scratch, workers=6):
    network = Network(scratch / 'cache')
    image_dir = root / 'data/scene-thumbnails'
    image_dir.mkdir(parents=True, exist_ok=True)
    progress = scratch / 'results.jsonl'
    previous = {}
    if progress.exists():
        for line in progress.read_text(encoding='utf8').splitlines():
            result = json.loads(line)
            if not result.get('errors'):
                previous[result['planSha256']] = result
    output_lock = threading.Lock()

    def process(row):
        fingerprint = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
        if fingerprint in previous:
            return previous[fingerprint]
        scene = {key: row[key] for key in ('kind', 'path', 'files')}
        if row.get('archive'):
            scene['archive'] = row['archive']
        scene['data'] = dict(row['data'])
        errors = []
        for probe in row.get('probes', []):
            try:
                pinned_url(probe['url'], row)
                content = ply_content(network.get(probe['url'], 0, MAX_HEADER_BYTES))
                if content:
                    scene['data'][content] = {'status': 'header_checked', 'samplePath': probe['path']}
                elif 'geometry' not in scene['data']:
                    scene['data']['geometry'] = {'status': 'listed', 'samplePath': probe['path']}
            except Exception as error:
                scene['data'].setdefault('geometry', {'status': 'listed', 'samplePath': probe['path']})
                errors.append({'scope': 'companion_header', 'error': str(error), 'path': probe['path']})
        target = row.get('thumbnail')
        if target:
            try:
                if row.get('licenseCategory') != 'commercial':
                    raise ValueError('Preview requires commercial category')
                pinned_url(target['url'], row)
                body = archive_photo(network, target) if target.get('sourceArchive') else network.get(target['url'])
                preview, original = square_preview(body)
                digest = hashlib.sha256(preview).hexdigest()
                (image_dir / (digest + '.jpg')).write_bytes(preview)
                scene['thumbnail'] = {'file': digest + '.jpg', 'sourcePath': target['sourcePath'],
                    'sourceSha256': hashlib.sha256(body).hexdigest(), 'width': 320, 'height': 320,
                    'originalWidth': original[0], 'originalHeight': original[1], 'crop': 'center_square',
                    'license': row['license'], 'attribution': row['title']}
                if target.get('sourceArchive'):
                    scene['thumbnail']['sourceArchive'] = target['sourceArchive']
            except Exception as error:
                errors.append({'scope': 'thumbnail', 'error': str(error), 'path': target['sourcePath']})
        result = {'id': row['id'], 'sourceId': row['sourceId'], 'revision': row['revision'], 'scene': scene,
                  'planSha256': fingerprint, 'errors': errors}
        with output_lock:
            with progress.open('a', encoding='utf8') as stream:
                stream.write(json.dumps(result, ensure_ascii=True) + '\n')
            completed[0] += 1
            if completed[0] % 50 == 0 or errors:
                print(json.dumps({'completed': completed[0], 'id': row['id'], 'thumbnail': 'thumbnail' in scene, 'errors': errors}), flush=True)
        return result

    completed = [0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        results = list(executor.map(process, plan['rows']))
    sources = {}
    next_rows = {row['id']: row for row in plan['rows']}
    for result in results:
        row = next_rows[result['id']]
        thumbnail = result['scene'].get('thumbnail')
        if thumbnail:
            target = row['thumbnail']
            thumbnail['datasetLicense'] = row['license']
            thumbnail['license'] = target.get('imageLicense', row['license'])
            thumbnail['attribution'] = target.get('attribution', row['title'])
            for key in ('licenseUrl', 'creditUrl', 'registeredName'):
                if target.get(key):
                    thumbnail[key] = target[key]
        source = sources.setdefault(result['sourceId'], {'sourceId': result['sourceId'], 'revision': result['revision'], 'scenes': []})
        source['scenes'].append(result['scene'])
    policy = {'schemaVersion': 1, 'checkedAt': plan['checkedAt'], 'coverage': 'all_published_scenes',
        'scope': 'Exact scene-scoped content inventories and bounded companion headers. Previews are center-square crops of the first available registered photograph; original model loading evidence is separate.',
        'sources': list(sources.values())}
    (root / 'data/scene-contents.json.gz').write_bytes(gzip.compress(json.dumps(policy, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
    used = {row['scene']['thumbnail']['file'] for row in results if row['scene'].get('thumbnail')}
    for file in image_dir.iterdir():
        if file.is_file() and not file.is_symlink() and re.fullmatch(r'[a-f0-9]{64}\.jpg', file.name) and file.name not in used:
            file.unlink()
    summary = {'scenes': len(results), 'thumbnails': sum('thumbnail' in row['scene'] for row in results),
        'contents': dict(Counter(key for row in results for key in row['scene']['data'])),
        'errors': [dict(id=row['id'], **error) for row in results for error in row['errors']]}
    (scratch / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf8')
    print(json.dumps(summary), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--scratch', type=Path, default=Path('.tmp/scene-card-content'))
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    args.scratch.mkdir(parents=True, exist_ok=True)
    prepare(json.loads(args.plan.read_bytes()), args.root, args.scratch, max(1, min(args.workers, 8)))
