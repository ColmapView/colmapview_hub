import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.catalog.source_pair_repairs import repair_reviews, apply_repair


class SourcePairRepairsTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self.catalog = json.loads((self.root / 'data/catalog.json').read_text(encoding='utf-8'))
        self.policy = json.loads((self.root / 'data/source-pair-repairs.json').read_text(encoding='utf-8'))

    def test_exact_source_pair_retains_geometry_and_gaussian_choices(self):
        review = next(iter(repair_reviews(self.catalog, self.policy, self.root).values()))
        manifest = json.loads(review['body'])
        self.assertEqual(len(manifest['splats']), 24)
        self.assertEqual(review['photos'], 25)
        self.assertEqual(review['samples'], 4)
        self.assertIn('/solve/t2/', manifest['files']['cameras'])
        self.assertIn('/undistorted/test/', manifest['files']['points3D'])
        original = {**manifest, 'files': {**manifest['files'], 'cameras': 'original-cameras.bin'}}
        from urllib.parse import parse_qs, urlsplit
        name = parse_qs(urlsplit(review['originalViewerUrl']).query)['url'][0].rsplit('/', 1)[-1]
        assets = {name: json.dumps(original).encode()}
        proof = {'viewerUrl': review['originalViewerUrl'], 'sceneCompatibility': {'images': 25, 'points': 29815},
                 'availableData': {'images': {'status': 'checked'}, 'splats': {'status': 'checked', 'count': 24}},
                 'calibrationReview': {'status': 'suspect'}}
        parent = {'sourceId': review['sourceId']}
        row = [review['kind'], review['path'], review['files'], None]
        result = apply_repair(parent, row, review['revision'], proof, review, assets)
        self.assertEqual(result['sceneCompatibility'], proof['sceneCompatibility'])
        self.assertEqual(result['availableData']['splats'], proof['availableData']['splats'])
        self.assertNotIn('duplicateImageTracks', result['sourcePairRepair'])
        self.assertNotIn('calibrationReview', result)
        self.assertIn('calibrationReview', proof)
        for change in ('points', 'splats', 'launch'):
            altered = copy.deepcopy(original)
            checked = copy.deepcopy(proof)
            if change == 'points':
                altered['files']['points3D'] = 'different-points.bin'
            elif change == 'splats':
                altered['splats'] = []
            else:
                checked['viewerUrl'] += '&other=scene'
            with self.subTest(change=change), self.assertRaises(ValueError):
                apply_repair(parent, row, review['revision'], checked, review, {name: json.dumps(altered).encode()})

    def test_bad_receipts_and_still_shifted_photos_cannot_enable_repair(self):
        for change in ('receipt', 'poses', 'points', 'coverage', 'pixels', 'errors'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                policy = copy.deepcopy(self.policy)
                item = policy['repairs'][0]
                for field in ('receipt', 'manifest'):
                    destination = root / item[field]
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes((self.root / item[field]).read_bytes())
                receipt_path = root / item['receipt']
                receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
                alternative = receipt['verifiedAlternative']
                if change == 'poses': alternative['samePoses'] -= 1
                elif change == 'points': alternative['maxSharedCoordinateDelta'] = 1
                elif change == 'coverage': alternative['photos']['coverage'].pop()
                elif change == 'pixels': alternative['photos']['colorComparison'][0]['best'][0]['dx'] = 10
                elif change == 'errors': alternative['browser']['uncaughtErrors'] = ['failed']
                receipt_path.write_text(json.dumps(receipt), encoding='utf-8')
                if change != 'receipt':
                    item['receiptSha256'] = hashlib.sha256(receipt_path.read_bytes()).hexdigest()
                with self.assertRaises(ValueError):
                    repair_reviews(self.catalog, policy, root)
