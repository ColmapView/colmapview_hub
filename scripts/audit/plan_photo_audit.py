"""Plan only new/unresolved photo work. This command never reads the network."""

import argparse
from collections import Counter
import csv
import gzip
import json
from pathlib import Path

from ..catalog.photo_decisions import decision_records, decision_coverage


def plan_photo_audit(root, source_filter=None):
    records = decision_records(json.loads(gzip.decompress((root / 'data/photo-audit-decisions.json.gz').read_bytes())))
    public = root / 'public/hub/datasets/individual'
    index = json.loads((public / 'index.json').read_bytes())
    with (public / 'photo-audit.csv').open(encoding='utf-8-sig', newline='') as handle:
        revisions = {row['id']: row['revision'] for row in csv.DictReader(handle)}
    rows = []
    for pack in sorted((public / 'packs').glob('*.json')):
        rows.extend(json.loads(pack.read_bytes()))
    ids = {row[0] for row in rows}
    if (len(rows) != index['total'] or len(ids) != len(rows) or ids != revisions.keys()
            or json.loads((public / 'index.json').read_bytes())['generation'] != index['generation']):
        raise ValueError('Incomplete or changing catalog snapshot; finish the catalog build before planning audits')
    pending, retained = [], Counter()
    for row in rows:
        source = index['sources'][row[1]]['sourceId']
        if source_filter and source != source_filter:
            continue
        coverage = decision_coverage(records, source, revisions[row[0]], row[2], row[3], row[6])
        if coverage['repeatAudit'] == 'skip_confirmed_facts':
            retained[coverage['auditDecision']] += 1
        else:
            pending.append({'id': row[0], 'sourceId': source, 'revision': revisions[row[0]],
                'kind': row[2], 'path': row[3], 'files': row[6], **coverage})
    return {'scope': 'Reuse the recorded facts only; sampled checks do not certify complete photo/export coverage.',
        'generation': index['generation'], 'retainedConfirmedFacts': sum(retained.values()),
        'retainedDecisions': dict(retained), 'needsReview': len(pending), 'scenes': pending}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    parser.add_argument('--source')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    report = plan_photo_audit(args.root, args.source)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'scenes'}))


if __name__ == '__main__':
    main()
