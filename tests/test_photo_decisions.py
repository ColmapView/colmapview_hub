import copy
import csv
import gzip
import json
from pathlib import Path
import tempfile
import unittest

from scripts.catalog.photo_decisions import decision_records, decision_digest, selection_key, reusable_decision, decision_coverage
from scripts.catalog.scene_contents import valid_preview_geometry
from scripts.audit.plan_photo_audit import plan_photo_audit


class PhotoDecisionTests(unittest.TestCase):
    def test_new_previews_keep_the_complete_frame_without_reprocessing_legacy_crops(self):
        self.assertTrue(valid_preview_geometry({'crop': 'center_square', 'width': 320, 'height': 320}))
        fitted = {'crop': 'aspect_fit', 'width': 320, 'height': 234, 'originalWidth': 4112, 'originalHeight': 3008}
        self.assertTrue(valid_preview_geometry(fitted))
        self.assertFalse(valid_preview_geometry({**fitted, 'height': 320}))
        self.assertFalse(valid_preview_geometry({**fitted, 'width': 640, 'height': 468}))

    def setUp(self):
        self.selection = ('hf:owner/data', 'a' * 40, 'colmap', 'scene/sparse/0', {'cameras': 'scene/sparse/0/cameras.bin'})
        self.item = dict(zip(('sourceId', 'revision', 'kind', 'path', 'files'), self.selection))
        self.item.update(selectionKey=selection_key(*self.selection), decision='no_loose_photos',
            confirmed=True, scope='Complete pinned repository listing, not external sources.',
            nextAction='external_photos_required', checkedAt='2026-10-19',
            evidence=[{'kind': 'complete_inventory', 'sha256': 'b' * 64}])

    def records(self, item=None):
        item = copy.deepcopy(item or self.item)
        item['sha256'] = decision_digest(item)
        return decision_records({'schemaVersion': 1, 'checkedAt': '2026-10-19', 'scenes': [item]})

    def test_same_immutable_selection_reuses_the_confirmed_scope(self):
        records = self.records()
        self.assertIsNotNone(reusable_decision(records, *self.selection))
        coverage = decision_coverage(records, *self.selection)
        self.assertEqual(coverage['repeatAudit'], 'skip_confirmed_facts')
        self.assertIn('not external', coverage['decisionScope'])
        self.assertEqual(coverage['nextAuditAction'], 'external_photos_required')

    def test_offline_planner_rejects_partial_builds_instead_of_silently_skipping_missing_scenes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'data').mkdir()
            records = list(self.records().values())
            (root / 'data/photo-audit-decisions.json.gz').write_bytes(gzip.compress(json.dumps({
                'schemaVersion': 1, 'checkedAt': '2026-10-19', 'scenes': records}).encode()))
            public = root / 'public/hub/datasets/individual'
            (public / 'packs').mkdir(parents=True)
            (public / 'index.json').write_text(json.dumps({'generation': 'checked', 'total': 1,
                'sources': [{'sourceId': self.selection[0]}]}), encoding='utf-8')
            row = ['scene', 0, self.selection[2], self.selection[3], 'COLMAP', None, self.selection[4], {}]
            pack = public / 'packs/0.json'
            pack.write_text(json.dumps([row]), encoding='utf-8')
            with (public / 'photo-audit.csv').open('w', encoding='utf-8', newline='') as stream:
                writer = csv.DictWriter(stream, fieldnames=['id', 'revision'])
                writer.writeheader()
                writer.writerow({'id': 'scene', 'revision': self.selection[1]})
            report = plan_photo_audit(root)
            self.assertEqual((report['retainedConfirmedFacts'], report['needsReview']), (1, 0))
            for incomplete in ([], [row, row]):
                pack.write_text(json.dumps(incomplete), encoding='utf-8')
                with self.assertRaisesRegex(ValueError, 'Incomplete or changing'):
                    plan_photo_audit(root, 'unrelated-source')

    def test_changed_revision_path_or_files_cannot_inherit_an_absence(self):
        for offset, value in [(1, 'c' * 40), (3, 'peer/sparse/0'), (4, {'cameras': 'other/cameras.bin'})]:
            selection = list(self.selection)
            selection[offset] = value
            self.assertIsNone(reusable_decision(self.records(), *selection))
            self.assertEqual(decision_coverage(self.records(), *selection)['repeatAudit'], 'review_required')

    def test_unresolved_associations_are_queued_even_when_the_inventory_is_unchanged(self):
        item = {**self.item, 'confirmed': False, 'decision': 'unresolved_association'}
        records = self.records(item)
        self.assertIsNone(reusable_decision(records, *self.selection))
        self.assertEqual(decision_coverage(records, *self.selection)['auditDecision'], 'unresolved_association')

    def test_changed_evidence_without_a_new_decision_digest_is_rejected(self):
        item = {**self.item, 'sha256': decision_digest(self.item)}
        item['scope'] = 'All photos and full exports checked'
        with self.assertRaisesRegex(ValueError, 'selection-bound'):
            decision_records({'schemaVersion': 1, 'checkedAt': '2026-10-19', 'scenes': [item]})

    def test_mutable_public_references_are_not_permanently_skipped(self):
        item = {**self.item, 'revision': 'main'}
        item['selectionKey'] = selection_key(*(item[field] for field in ('sourceId', 'revision', 'kind', 'path', 'files')))
        with self.assertRaisesRegex(ValueError, 'immutable'):
            self.records(item)

    def test_verified_public_content_snapshots_retain_their_existing_fact_scope(self):
        item = {**self.item, 'revision': 'c' * 64, 'revisionKind': 'content_snapshot',
            'evidence': [*self.item['evidence'], {'kind': 'source_snapshot', 'sha256': 'c' * 64}]}
        selection = tuple(item[field] for field in ('sourceId', 'revision', 'kind', 'path', 'files'))
        item['selectionKey'] = selection_key(*selection)
        self.assertIsNotNone(reusable_decision(self.records(item), *selection))
        item['evidence'] = self.item['evidence']
        with self.assertRaisesRegex(ValueError, 'source snapshot'):
            self.records(item)
