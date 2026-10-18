"""Retain positively identified archive paths without inventing archive coverage."""
import gzip
import hashlib
import json
from collections import Counter
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlsplit


def supplement_rows(rows, result, revision):
    if not result or result.get('revision') != revision or not result.get('sourceId', '').startswith('hf:'):
        return rows
    prefix = '/datasets/' + quote(result['sourceId'][3:], safe='/') + '/resolve/' + revision + '/'
    candidates = []
    for archive in result.get('probes', []):
        url = urlsplit(archive.get('url', ''))
        if not archive.get('completeDirectory') or url.netloc != 'huggingface.co' or not url.path.startswith(prefix):
            continue
        archive_path = unquote(url.path[len(prefix):])
        members = archive.get('probes', [])
        for member in members:
            if member.get('format') in {'point_cloud_ply', 'gaussian_ply'} and member.get('path'):
                candidates.append(['ply', member['path'], None, archive_path])
        native = {member['role']: member['path'] for member in members if member.get('role') in {'cameras', 'images', 'points3d'} and member.get('path')}
        directory = archive.get('modelDirectory')
        if archive.get('format') == 'colmap' and set(native) == {'cameras', 'images', 'points3d'} and directory is not None:
            if all(str(PurePosixPath(path).parent) == directory for path in native.values()):
                candidates.append(['colmap', directory, native, archive_path])
    existing = {(row[0], row[1], row[3]) for row in rows}
    grouped = {(row[3], value) for row in rows for value in (row[2] or {}).values()}
    native_locations = {(row[3], row[1]) for row in rows if row[0] in {'colmap', 'cameras'}}
    additions = []
    for row in candidates:
        key = (row[0], row[1], row[3])
        if key in existing or (row[3], row[1]) in grouped or (row[0] == 'colmap' and (row[3], row[1]) in native_locations):
            continue
        existing.add(key)
        additions.append(row)
    return rows + sorted(additions, key=lambda row: (row[3], row[1], row[0]))


def update(root):
    audit = {row['sourceId']: row for row in json.loads((root / 'data/dataset-audit.json').read_text(encoding='utf-8'))['results']}
    path = root / 'data/individual-datasets.json'
    registry = json.loads(path.read_text(encoding='utf-8'))
    changed, added, counts = [], 0, Counter()
    for source in registry['sources']:
        target = root / 'data/individual-datasets' / source['file']
        original = target.read_bytes()
        if hashlib.sha256(original).hexdigest() != source['sha256']:
            raise ValueError('Canonical listing checksum changed: ' + source['sourceId'])
        listing = json.loads(gzip.decompress(original))
        before = listing['items']
        after = supplement_rows(before, audit.get(source['sourceId']), source['revision'])
        counts.update(row[0] for row in after)
        if len(before) == len(after):
            continue
        listing['items'] = after
        listing['archiveCoverage'] = 'Previously inspected archive models plus exact positive model/header paths from the pinned source audit; other archive members and nested contents are not enumerated.'
        payload = gzip.compress(json.dumps(listing, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0)
        target.write_bytes(payload)
        source['sha256'] = hashlib.sha256(payload).hexdigest()
        source['count'] = len(after)
        added += len(after) - len(before)
        changed.append(source['sourceId'])
    if changed:
        registry['counts'] = dict(sorted(counts.items()))
        registry['individualEntries'] = sum(counts.values())
        path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'supplementedSources': len(changed), 'addedPositiveArchiveItems': added, 'individualListingEntries': registry['individualEntries']}))


if __name__ == '__main__':
    update(Path(__file__).resolve().parents[2])
