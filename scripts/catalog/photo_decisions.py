"""Revision-bound audit facts; reusing a fact never upgrades its evidence scope."""

import hashlib
import json
import re


def canonical_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False).encode()


def selection_key(source_id, revision, kind, path, files):
    return hashlib.sha256(canonical_bytes({'sourceId': source_id, 'revision': revision,
        'kind': kind, 'path': path, 'files': files})).hexdigest()


def decision_digest(item):
    return hashlib.sha256(canonical_bytes({key: value for key, value in item.items() if key != 'sha256'})).hexdigest()


def decision_records(policy):
    if policy.get('schemaVersion') != 1 or not policy.get('checkedAt') or not isinstance(policy.get('scenes'), list):
        raise ValueError('Invalid photo audit decision log')
    records = {}
    for item in policy['scenes']:
        key = selection_key(*(item.get(field) for field in ('sourceId', 'revision', 'kind', 'path', 'files')))
        if (item.get('selectionKey') != key or item.get('sha256') != decision_digest(item)
                or not isinstance(item.get('sourceId'), str) or not isinstance(item.get('revision'), str)
                or not isinstance(item.get('files'), dict) or not item['files']
                or not isinstance(item.get('decision'), str) or not item['decision']
                or not isinstance(item.get('scope'), str) or not item['scope']
                or not isinstance(item.get('nextAction'), str) or not item['nextAction']
                or type(item.get('confirmed')) is not bool or not item.get('checkedAt')
                or not isinstance(item.get('evidence'), list) or not item['evidence']):
            raise ValueError('Photo decisions require selection-bound facts, scope and receipts')
        for receipt in item['evidence']:
            if (not isinstance(receipt.get('kind'), str) or not receipt['kind']
                    or re.fullmatch('[a-f0-9]{64}', receipt.get('sha256', '')) is None):
                raise ValueError('Photo decision evidence must retain a receipt digest')
        if key in records:
            raise ValueError('Duplicate photo audit decision')
        # Public scenes may already have a verified content snapshot rather
        # than a Git commit. Preserve that exact receipt identity as well.
        commit = re.fullmatch('[a-f0-9]{40}', item['revision']) is not None
        snapshot = (item.get('revisionKind') == 'content_snapshot'
                    and re.fullmatch('[a-f0-9]{64}', item['revision']) is not None
                    and any(receipt['kind'] == 'source_snapshot' and receipt['sha256'] == item['revision'] for receipt in item['evidence']))
        if item['confirmed'] and not (commit or snapshot):
            raise ValueError('Reusable photo decisions require an immutable revision or source snapshot')
        records[key] = item
    return records


def reusable_decision(records, source_id, revision, kind, path, files):
    item = records.get(selection_key(source_id, revision, kind, path, files))
    return item if item and item['confirmed'] else None


def decision_coverage(records, source_id, revision, kind, path, files):
    item = records.get(selection_key(source_id, revision, kind, path, files))
    return {'auditDecision': item['decision'] if item else 'new_or_changed_selection',
        'repeatAudit': 'skip_confirmed_facts' if item and item['confirmed'] else 'review_required',
        'decisionScope': item['scope'] if item else '',
        'nextAuditAction': item['nextAction'] if item else 'audit_new_or_changed_selection'}
