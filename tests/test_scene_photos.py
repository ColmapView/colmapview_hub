import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from scene_photos import apply_photo_evidence, photo_scene_reviews


class ScenePhotoTests(unittest.TestCase):
    def setUp(self):
        self.entry = {'sourceId': 'hf:owner/data', 'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        self.files = {'cameras': 'scene/sparse/0/cameras.bin', 'images': 'scene/sparse/0/images.bin', 'points3d': 'scene/sparse/0/points3D.bin'}
        self.audit = {'status': 'sample_checked', 'checkedAt': '2026-10-17', 'policy': 'native_scene',
                      'summary': 'A photo sample passed; complete loading is separate.', 'listingComplete': True,
                      'samplePath': 'scene/images/a.jpg', 'sampleBrowserRead': True, 'samplePixels': 'decoded'}
        self.scene = {'kind': 'colmap', 'path': 'scene/sparse/0', 'files': self.files, 'audit': self.audit}
        self.policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'sources': [
            {'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'scenes': [self.scene]}]}

    def review(self):
        return next(iter(photo_scene_reviews({'entries': [self.entry]}, self.policy).values()))

    def test_exact_revision_and_files_are_required(self):
        review = self.review()
        proof = {'level': 'native_layout_checked', 'photoAvailability': 'not_checked'}
        row = ['colmap', self.scene['path'], self.files, None]
        result = apply_photo_evidence(self.entry, row, 'a' * 40, proof, review)
        self.assertEqual(result['photoAvailability'], 'sample_checked')
        self.assertNotIn('photoAudit', proof)
        with self.assertRaisesRegex(ValueError, 'model files changed'):
            apply_photo_evidence(self.entry, [*row[:2], {**self.files, 'images': 'moved/images.bin'}, None], 'a' * 40, proof, review)
        self.policy['sources'][0]['revision'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'revision changed'):
            self.review()

    def test_duplicate_scene_proofs_are_rejected(self):
        self.policy['sources'][0]['scenes'].append(copy.deepcopy(self.scene))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.review()

    def test_incomplete_listing_or_unchecked_photo_cannot_claim_a_sample(self):
        for field, value in [('listingComplete', False), ('sampleBrowserRead', False), ('samplePixels', None)]:
            with self.subTest(field):
                policy = copy.deepcopy(self.policy)
                policy['sources'][0]['scenes'][0]['audit'][field] = value
                with self.assertRaises(ValueError):
                    photo_scene_reviews({'entries': [self.entry]}, policy)

    def test_partial_photo_counts_cannot_exceed_the_registered_set(self):
        self.audit.update({'status': 'partial', 'nameCheck': {'registered': 48, 'matched': 40}})
        self.assertEqual(self.review()['audit']['nameCheck']['matched'], 40)
        self.audit['nameCheck']['matched'] = 49
        with self.assertRaisesRegex(ValueError, 'coverage counts'):
            self.review()

    def test_companion_zip_requires_browser_range_and_name_evidence(self):
        self.audit.update({'status': 'companion_archive', 'archive': {'path': 'scene/images.zip', 'photos': 48,
            'nameSampleMatched': True, 'browserRangeRead': True}})
        self.review()
        self.audit['archive']['browserRangeRead'] = False
        with self.assertRaisesRegex(ValueError, 'indexed ZIP'):
            self.review()

    def test_photos_never_upgrade_model_compatibility_or_complete_export(self):
        proof = {'level': 'native_layout_checked', 'delivery': 'cors_headers_checked', 'viewerUrl': 'model-url'}
        row = ['colmap', self.scene['path'], self.files, None]
        updated = apply_photo_evidence(self.entry, row, 'a' * 40, proof, self.review())
        self.assertEqual(updated['level'], proof['level'])
        self.assertEqual(updated['delivery'], proof['delivery'])
        self.assertEqual(updated['viewerUrl'], proof['viewerUrl'])
        self.assertNotIn('sceneValidation', updated)
        complete = {**proof, 'photoAvailability': 'complete_export_checked'}
        self.assertEqual(apply_photo_evidence(self.entry, row, 'a' * 40, complete, self.review())['photoAvailability'], 'complete_export_checked')
        self.audit['status'] = 'partial'
        with self.assertRaisesRegex(ValueError, 'conflicts with a complete'):
            apply_photo_evidence(self.entry, row, 'a' * 40, complete, self.review())

    def test_a_publisher_exclusion_is_not_overridden_by_found_masks(self):
        self.entry['verification'] = {'sourceImages': {'status': 'not_included'}}
        with self.assertRaisesRegex(ValueError, 'publisher RGB exclusion'):
            apply_photo_evidence(self.entry, ['colmap', self.scene['path'], self.files, None], 'a' * 40, {}, self.review())


if __name__ == '__main__':
    unittest.main()
