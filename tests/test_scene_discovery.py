import gzip
import json
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from scripts.catalog.scene_discovery import HISTORY, discovery_row, load_history, update_history


class SceneDiscoveryTests(unittest.TestCase):
    def test_model_only_and_photo_exports_have_the_same_confidence(self):
        model = {'sceneValidation': {'status': 'passed', 'export': 'colmap_model'}, 'photoAvailability': 'not_included'}
        photos = {'sceneValidation': {'status': 'passed', 'export': 'colmap_images'}, 'photoAvailability': 'complete_export_checked'}
        self.assertEqual(discovery_row(model, None), discovery_row(photos, None))
        self.assertEqual(discovery_row(model, None), [3, 0, 0])
        self.assertEqual(discovery_row({'delivery': 'browser_readable'}, None), [2, 0, 0])

    def test_catalogue_dates_survive_rebuilds_removal_and_reappearance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            output = root / 'public/hub/datasets/individual'
            (output / 'packs').mkdir(parents=True)
            identities = ['data-' + character * 24 for character in 'ab']
            def write(ids):
                (output / 'index.json').write_text(json.dumps({'total': len(ids), 'packSize': 24}))
                (output / 'packs/0.json').write_text(json.dumps([[identity] for identity in ids]))
            write(identities[:1])
            self.assertEqual(update_history(root, '2026-10-17'), 1)
            self.assertEqual(update_history(root, '2026-10-18'), 0)
            write(identities[1:])
            self.assertEqual(update_history(root, '2026-10-18'), 1)
            write(identities)
            self.assertEqual(update_history(root, '2026-10-19'), 0)
            history = load_history((root / HISTORY).read_bytes())['firstSeen']
            self.assertEqual(history, dict(zip(identities, ['2026-10-17', '2026-10-18'])))

    def test_unknown_dates_are_neutral_and_rechecks_do_not_supply_new_dates(self):
        proof = {'delivery': 'cors_headers_checked', 'checkedAt': '2099-01-01'}
        self.assertEqual(discovery_row(proof, None)[2], 0)
        self.assertGreater(discovery_row(proof, '2026-10-17')[2], 0)

    def test_history_rejects_wrong_identities_dates_and_future_publications(self):
        for identity, day in [('data-' + 'z' * 24, '2026-10-19'), ('data-' + 'a' * 24, '2026-02-30'), ('data-' + 'a' * 24, '1960-01-01')]:
            raw = gzip.compress(json.dumps({'schemaVersion': 1, 'firstSeen': {identity: day}}).encode())
            with self.assertRaises(ValueError):
                load_history(raw)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                update_history(Path(directory), (date.today() + timedelta(days=1)).isoformat())

    def test_partial_catalogue_never_modifies_history(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            output = root / 'public/hub/datasets/individual'
            (output / 'packs').mkdir(parents=True)
            (output / 'index.json').write_text(json.dumps({'total': 2, 'packSize': 24}))
            (output / 'packs/0.json').write_text(json.dumps([['data-' + 'a' * 24]]))
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                update_history(root, '2026-10-19')
            self.assertFalse((root / HISTORY).exists())
