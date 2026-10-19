"""Offline discovery metadata. Builds never manufacture publication dates."""

import argparse
import gzip
import json
import re
from datetime import date
from pathlib import Path

HISTORY = 'data/scene-discovery-history.json.gz'


def load_history(raw):
    history = json.loads(gzip.decompress(raw)) if raw else {'schemaVersion': 1, 'firstSeen': {}}
    if history.get('schemaVersion') != 1 or not isinstance(history.get('firstSeen'), dict):
        raise ValueError('Invalid scene discovery history')
    for identity, day in history['firstSeen'].items():
        if not isinstance(identity, str) or not re.fullmatch(r'data-[a-f0-9]{24}', identity):
            raise ValueError('Invalid discovery scene identity')
        if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day or date.fromisoformat(day) < date(1970, 1, 2):
            raise ValueError('Invalid first-catalogued date')
    return history


def discovery_row(proof, first_seen):
    # Complete model-only and photo exports have the same model confidence.
    tier = 3 if proof.get('sceneValidation', {}).get('status') == 'passed' else 2 if proof.get('delivery') == 'browser_readable' else 1
    day = (date.fromisoformat(first_seen) - date(1970, 1, 1)).days if first_seen else 0
    return [tier, int(bool(proof.get('thumbnail'))), day]


def update_history(root, day):
    """Stamp new qualified scene identities; retain dates for removed/reappearing IDs."""
    parsed = date.fromisoformat(day)
    if parsed.isoformat() != day or parsed > date.today() or parsed < date(1970, 1, 2):
        raise ValueError('Use a real publication date in YYYY-MM-DD format, not a future date')
    path = root / HISTORY
    history = load_history(path.read_bytes() if path.exists() else None)
    output = root / 'public/hub/datasets/individual'
    index_bytes = (output / 'index.json').read_bytes()
    index = json.loads(index_bytes)
    additions = 0
    seen = set()
    for number in range((index['total'] + index['packSize'] - 1) // index['packSize']):
        for row in json.loads((output / f'packs/{number}.json').read_bytes()):
            if not re.fullmatch(r'data-[a-f0-9]{24}', row[0]) or row[0] in seen:
                raise ValueError('Discovery history requires unique scene identities')
            seen.add(row[0])
            if row[0] not in history['firstSeen']:
                history['firstSeen'][row[0]] = day
                additions += 1
    if len(seen) != index['total'] or (output / 'index.json').read_bytes() != index_bytes:
        raise ValueError('The built catalog changed or is incomplete; finish its build before recording discovery dates')
    raw = json.dumps(history, sort_keys=True, separators=(',', ':')).encode()
    path.write_bytes(gzip.compress(raw, mtime=0))
    return additions


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', default=date.today().isoformat(), help='Date these scenes first become available in the Hub')
    args = parser.parse_args()
    print(f'Recorded {update_history(Path("."), args.date)} newly catalogued scenes. Rebuild the catalog to publish their dates.')
