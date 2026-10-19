"""Fill missing previews from the catalog's checked scene photographs.

Run separately from builds with Pillow installed:
python -m scripts.audit.prepare_scene_previews --scratch .tmp/scene-previews
An optional --archive-credits CSV retains publisher-provided per-photo terms.
Existing previews and all model/photo loading evidence are preserved.
"""

import argparse
import concurrent.futures
import csv
import gzip
import hashlib
import html
import json
import re
import threading
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .prepare_scene_contents import ArchiveReader, Network, archive_photo, pinned_url, square_preview
from ..catalog.scene_contents import PHOTO_STATES, content_scene_reviews, is_metadata_sidecar, photo_source_path
from ..catalog.scene_photos import photo_scene_reviews
from ..catalog.scene_qualification import scene_key


def photo_url(source, path):
    if source['sourceId'].startswith('hf:'):
        url = ('https://huggingface.co/datasets/' + source['sourceId'][3:] + '/resolve/'
               + source['revision'] + '/' + urllib.parse.quote(path, safe='/'))
        pinned_url(url, source)
        return url
    if (source['sourceId'].startswith('public:') and urllib.parse.urlsplit(path).scheme == 'https'
            and photo_source_path(path, {'provider': 'public'})):
        return path
    raise ValueError('Preview requires an exact checked public source')


def preview_jobs(catalog, contents, photos, root):
    content_scene_reviews(catalog, contents, root)
    audits = photo_scene_reviews(catalog, photos)
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    jobs, retained, placeholders = [], 0, Counter()
    for source in contents['sources']:
        for scene in source['scenes']:
            key = scene_key(source['sourceId'], scene['kind'], scene['path'], scene.get('archive'))
            review = audits[key]
            if review['revision'] != source['revision'] or review['files'] != scene['files']:
                raise ValueError('Preview scene identity changed')
            if scene.get('thumbnail'):
                retained += 1
                continue
            audit = review['audit']
            if audit['status'] not in PHOTO_STATES:
                placeholders[audit['status']] += 1
                continue
            path = audit.get('samplePath') or (audit.get('archive') or {}).get('path')
            if not path or is_metadata_sidecar(path):
                raise ValueError('Checked photos require a real sample or companion archive')
            url = photo_url(source, path)
            jobs.append({'key': key, 'source': source, 'scene': scene, 'audit': audit,
                         'entry': parents[source['sourceId']], 'url': url})
    return jobs, retained, dict(placeholders)


def archive_credits(path, jobs):
    """Read only the missing archive scenes from a publisher image inventory."""
    if path is None:
        return {}
    prefixes = {job['audit']['archive']['path'].removeprefix('scenes/').rsplit('/', 1)[0]
                for job in jobs if job['source']['sourceId'] == 'hf:cornell-vailab/megaunscene'
                and job['audit'].get('archive')}
    result = {}
    with path.open(encoding='utf8', newline='') as stream:
        for row in csv.DictReader(stream):
            key = row['scene'] + '/' + row['recon_id']
            if key in prefixes:
                result.setdefault(key, {})[row['image_name']] = row
    return result


def archive_target(network, job, credits):
    evidence = job['audit']['archive']
    if evidence.get('format') == 'tar':
        sample = evidence['sample']
        return {'url': job['url'], 'sourcePath': sample['path'], 'sourceArchive': evidence['path'],
                'archiveFormat': 'tar', 'archiveBytes': evidence['bytes'], 'registeredName': sample['registeredName'],
                'headerOffset': sample['headerOffset'], 'dataOffset': sample['dataOffset'], 'bytes': sample['bytes'],
                'sourceSha256': sample['sha256'], 'imageLicense': 'Not specified'}
    request = urllib.request.Request(job['url'], method='HEAD')
    with urllib.request.urlopen(request, timeout=40) as response:
        size = int(response.headers['Content-Length'])
    if size < 22:
        raise ValueError('Invalid photo archive size')
    reader = ArchiveReader(network, job['url'], size)
    with zipfile.ZipFile(reader) as archive:
        names = {info.filename for info in archive.infolist() if not info.is_dir()
                 and not is_metadata_sidecar(info.filename)
                 and Path(info.filename).suffix.lower() in {'.jpg', '.jpeg', '.png', '.webp'}}
    prefix = job['audit']['archive']['path'].removeprefix('scenes/').rsplit('/', 1)[0]
    metadata = credits.get(prefix, {}) if job['source']['sourceId'] == 'hf:cornell-vailab/megaunscene' else {}
    ordered = sorted(names, key=lambda name: (int(metadata.get(name, {}).get('image_id', 2**63)), name))
    if not ordered:
        raise ValueError('Photo archive has no supported images')
    name = ordered[0]
    target = {'url': job['url'], 'sourcePath': name, 'sourceArchive': job['audit']['archive']['path'],
              'archiveBytes': size, 'registeredName': name, 'imageLicense': 'Not specified'}
    record = metadata.get(name)
    if record:
        target['imageLicense'] = record.get('license') or 'Not specified'
        target['attribution'] = html.unescape(re.sub('<[^>]*>', '', record.get('artist') or record.get('user') or '')).strip()
        target['creditUrl'] = 'https://commons.wikimedia.org/wiki/File:' + urllib.parse.quote(record['image_filename'])
        if record.get('license_url', '').startswith('https://creativecommons.org/'):
            target['licenseUrl'] = record['license_url']
    return target


def prepare(root, scratch, workers=6, credits_path=None):
    scratch.mkdir(parents=True, exist_ok=True)
    read = lambda name: json.loads((root / 'data' / name).read_bytes())
    contents_path = root / 'data/scene-contents.json.gz'
    original_policy = contents_path.read_bytes()
    contents = json.loads(gzip.decompress(original_policy))
    photos = json.loads(gzip.decompress((root / 'data/scene-photos.json.gz').read_bytes()))
    catalog = read('catalog.json')
    jobs, retained, placeholders = preview_jobs(catalog, contents, photos, root)
    credits = archive_credits(credits_path, jobs)
    credits_hash = hashlib.sha256(credits_path.read_bytes()).hexdigest() if credits_path else None
    network = Network(scratch / 'cache')
    image_dir = root / 'data/scene-thumbnails'
    image_dir.mkdir(parents=True, exist_ok=True)
    receipts = scratch / 'results.jsonl'
    previous = {}
    if receipts.exists():
        for line in receipts.read_text(encoding='utf8').splitlines():
            result = json.loads(line)
            if not result.get('error'):
                previous[result['fingerprint']] = result
    lock, completed = threading.Lock(), [0]
    print(json.dumps({'jobs': len(jobs), 'retained': retained, 'placeholders': placeholders}), flush=True)

    def process(job):
        fingerprint = hashlib.sha256(json.dumps([job['key'], job['source']['revision'], job['audit'], job['entry']['license'],
                                                 credits_hash if job['audit'].get('archive') else None],
                                                 sort_keys=True).encode()).hexdigest()
        prior = previous.get(fingerprint)
        if prior:
            path = image_dir / prior['thumbnail']['file']
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() + '.jpg' == path.name:
                return prior
        result = {'key': job['key'], 'fingerprint': fingerprint, 'url': job['url']}
        try:
            audit = job['audit']
            target = archive_target(network, job, credits) if audit.get('archive') else {
                'sourcePath': audit['samplePath'], 'registeredName': audit.get('sampleRegisteredName')}
            body = archive_photo(network, target) if target.get('sourceArchive') else network.get(job['url'])
            preview, dimensions = square_preview(body)
            digest = hashlib.sha256(preview).hexdigest()
            path = image_dir / (digest + '.jpg')
            # Different model variants can share identical image bytes. Avoid
            # simultaneous replacement of the same asset on Windows.
            with lock:
                if path.exists():
                    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                        raise ValueError('Existing preview asset bytes changed')
                else:
                    temporary = path.with_suffix('.tmp')
                    temporary.write_bytes(preview)
                    temporary.replace(path)
            thumbnail = {'file': path.name, 'sourcePath': target['sourcePath'], 'sourceSha256': hashlib.sha256(body).hexdigest(),
                         'width': 320, 'height': 320, 'originalWidth': dimensions[0], 'originalHeight': dimensions[1],
                         'crop': 'center_square', 'datasetLicense': job['entry']['license'],
                         'license': target.get('imageLicense', job['entry']['license']),
                         'attribution': target.get('attribution') or job['entry']['title']}
            for key in ('sourceArchive', 'registeredName', 'creditUrl', 'licenseUrl'):
                if target.get(key):
                    thumbnail[key] = target[key]
            result['thumbnail'] = thumbnail
        except Exception as error:
            result['error'] = str(error)
        with lock:
            with receipts.open('a', encoding='utf8') as stream:
                stream.write(json.dumps(result, ensure_ascii=True) + '\n')
            completed[0] += 1
            if completed[0] % 50 == 0 or result.get('error'):
                print(json.dumps({'completed': completed[0], 'total': len(jobs), 'error': result.get('error')}), flush=True)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(workers, 8))) as executor:
        results = list(executor.map(process, jobs))
    by_key = {tuple(result['key']): result for result in results}
    for job in jobs:
        result = by_key[job['key']]
        if result.get('thumbnail'):
            job['scene']['thumbnail'] = result['thumbnail']
    # Validate every retained/new asset and reject concurrent evidence edits.
    content_scene_reviews(catalog, contents, root)
    if contents_path.read_bytes() != original_policy:
        raise ValueError('Content evidence changed during preparation; re-run against the new policy')
    contents['checkedAt'] = datetime.now(timezone.utc).isoformat()
    contents_path.write_bytes(gzip.compress(json.dumps(contents, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0))
    report = {'retained': retained, 'added': sum('thumbnail' in result for result in results),
              'placeholders': placeholders, 'errors': [result for result in results if result.get('error')]}
    (scratch / 'summary.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    print(json.dumps({**report, 'errors': len(report['errors'])}), flush=True)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'))
    parser.add_argument('--scratch', type=Path, default=Path('.tmp/scene-previews'))
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--archive-credits', type=Path)
    args = parser.parse_args()
    report = prepare(args.root, args.scratch, args.workers, args.archive_credits)
    raise SystemExit(1 if report['errors'] else 0)
