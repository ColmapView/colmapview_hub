"""Enumerate models inside public archives that previously represented whole collections.

Only ZIP directory metadata is read. Individual scene entries already present in
the public scene survey retain their identities and scope.
"""

import argparse
import hashlib
import json
import time
import zipfile
from collections import Counter
from pathlib import Path

from .dataset_audit import Network, RemoteZip, now
from .prepare_individual_datasets import individual_records, read, write_pack


def prepare(root=Path('.')):
    catalog = read(root / 'data/catalog.json')
    registry = read(root / 'data/individual-datasets.json')
    registry['sources'] = [source for source in registry['sources'] if source['sourceId'].startswith('hf:')]
    cache = root / '.tmp/public-model-listings'
    cache.mkdir(parents=True, exist_ok=True)
    network = Network()
    for entry in catalog['entries']:
        if entry['provider'] != 'public' or any(fact['label'] == 'Collection' for fact in entry['facts']):
            continue
        url = entry.get('dataUrl')
        if not url:
            continue
        cache_path = cache / (hashlib.sha256(url.encode()).hexdigest() + '.json.gz')
        if cache_path.exists():
            receipt = read(cache_path)
        else:
            try:
                remote = RemoteZip(network, url, time.monotonic() + 100)
                with zipfile.ZipFile(remote) as archive:
                    paths = [info.filename for info in archive.infolist() if not info.is_dir()]
                receipt = {'checkedAt': now()[:10], 'url': url, 'paths': paths, 'bytesRead': remote.transferred,
                           'scope': 'Complete ZIP central directory; original files and format headers not read in this enumeration.'}
                write_pack(cache_path, receipt)
            except Exception as error:
                # A whole collection is never silently turned into one scene.
                print(f'Public collection enumeration incomplete: {entry["sourceId"]}: {error}', flush=True)
                continue
        rows = individual_records(receipt['paths'], archive=url)
        # These audited sources explicitly identify one named capture, even when
        # their original camera schema needs conversion or no geometry exists.
        if not rows and ('middlebury-' in entry['sourceId'] or 'immersive-light-field-video-' in entry['sourceId']):
            rows = [['scene', entry['title'], None, url]]
        value = {'schemaVersion': 1, 'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'revision': None,
                 'checkedAt': receipt['checkedAt'], 'listingComplete': True, 'scope': receipt['scope'],
                 'archiveCoverage': 'This public archive directory only; native format and rendering evidence are separate.', 'items': rows}
        filename = entry['id'] + '.json.gz'
        digest = write_pack(root / 'data/individual-datasets' / filename, value)
        registry['sources'].append({'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'file': filename,
                                    'sha256': digest, 'count': len(rows), 'listingComplete': True, 'revision': None,
                                    'checkedAt': receipt['checkedAt'], 'scope': receipt['scope']})
        print(f'Public collection {entry["sourceId"]}: {len(rows)} individual entries', flush=True)
    counts = Counter()
    for source in registry['sources']:
        counts.update(row[0] for row in read(root / 'data/individual-datasets' / source['file'])['items'])
    registry['counts'] = dict(sorted(counts.items()))
    registry['individualEntries'] = sum(counts.values())
    (root / 'data/individual-datasets.json').write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path('.'))
    prepare(parser.parse_args().root)
