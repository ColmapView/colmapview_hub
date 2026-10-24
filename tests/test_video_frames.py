import copy
import gzip
import hashlib
import json
from pathlib import Path
import unittest

from scripts.catalog.build_individual_catalog import hf_url
from scripts.catalog.scene_manifests import manifest_assets
from scripts.catalog.scene_qualification import scene_key
from scripts.catalog.video_frames import review_digest, video_frame_reviews, video_frame_asset, video_frame_assets, apply_video_frames


class VideoFrameTests(unittest.TestCase):
    def setUp(self):
        self.catalog = json.loads(Path('data/catalog.json').read_bytes())
        self.model = next(scene for scene in json.loads(Path('data/scene-manifests.json').read_bytes())['scenes']
                          if scene.get('frameGeometry', {}).get('sequencePath') == 's6/BiancaGolden_Ocho')
        policy = json.loads(gzip.decompress(Path('data/video-frame-routing.json.gz').read_bytes()))
        self.review = next(scene for scene in policy['scenes'] if scene['id'] == self.model['id'])
        self.key = scene_key(self.model['sourceId'], self.model['kind'], self.model['path'])
        self.models = {self.key: self.model}
        self.parent = next(entry for entry in self.catalog['entries'] if entry['sourceId'] == self.model['sourceId'])

    def validate(self, review=None):
        return video_frame_reviews(self.catalog, {'schemaVersion': 1, 'scenes': [review or self.review]}, self.models, hf_url)

    def test_additive_manifest_preserves_all_native_geometry_and_settings_bytes(self):
        self.assertEqual(len(self.validate()), 1)
        name, body = video_frame_asset(self.review, self.model, self.parent, hf_url)
        original = json.loads(manifest_assets(self.model, self.parent, hf_url)[self.review['baseManifest']['file']])
        updated = json.loads(body)
        self.assertEqual(name, hashlib.sha256(body).hexdigest() + '.manifest.json')
        self.assertEqual(updated.pop('version'), 4)
        videos = updated.pop('videoImages')
        self.assertEqual(len(videos), 28)
        self.assertTrue(all(video['timestamp'] == 240 and video['playbackRate'] == 30 for video in videos.values()))
        original.pop('version'); original.pop('skipImages')
        self.assertEqual(updated, original)
        self.assertEqual(self.review['timestamp'], 240)  # ID 242 follows a dropped source frame.
        self.assertEqual(self.review['frameIds'][240], '0000242')

    def test_playback_rate_is_only_added_for_the_reviewed_publisher_revision_and_readme(self):
        for field in ('revision', 'sourceId', 'readme'):
            with self.subTest(field=field):
                review = copy.deepcopy(self.review)
                if field == 'readme': review[field]['sha256'] = '0' * 64
                else: review[field] = 'unreviewed'
                _, body = video_frame_asset(review, self.model, self.parent, hf_url)
                self.assertTrue(all('playbackRate' not in video for video in json.loads(body)['videoImages'].values()))

    def test_clean_build_reproduces_the_original_published_video_manifest(self):
        assets = video_frame_assets(self.review, self.model, self.parent, hf_url)
        original_name = 'f145182de4dfc8f40ef9ed12de94f9957baafa7f73df3329fd3d7a155efa7013.manifest.json'
        current_name, current_body = video_frame_asset(self.review, self.model, self.parent, hf_url)
        self.assertEqual(len(assets), 2)
        self.assertEqual(assets[current_name], current_body)
        self.assertEqual(hashlib.sha256(assets[original_name]).hexdigest() + '.manifest.json', original_name)
        current = json.loads(current_body)
        for binding in current['videoImages'].values():
            binding.pop('playbackRate')
        self.assertEqual(json.loads(assets[original_name]), current)

    def test_changed_frame_source_identity_and_incomplete_coverage_cannot_inherit_the_receipt(self):
        def timestamp(review): review['timestamp'] += 1
        def base(review): review['baseManifest']['sha256'] = '0' * 64
        def revision(review): review['revision'] = '0' * 40
        def incomplete(review): review['videos'].pop()
        def other_scene(review): review['videos'][0]['sourcePath'] = 's6/Other/Other_0028.mp4'
        def wrong_dimensions(review): review['sample']['width'] += 1
        def incomplete_packets(review): review['sample']['packetCount'] -= 1
        for edit in (timestamp, base, revision, incomplete, other_scene, wrong_dimensions, incomplete_packets):
            with self.subTest(change=edit.__name__):
                changed = copy.deepcopy(self.review); edit(changed)
                changed['receiptSha256'] = review_digest(changed)
                with self.assertRaises(ValueError): self.validate(changed)

    def test_photo_overlay_does_not_relabel_the_old_model_export_as_a_photo_export(self):
        model_receipt = {'url': 'base', 'sha256': 'a' * 64, 'exportSha256': 'b' * 64}
        proof = {'sceneManifest': model_receipt, 'availableData': {}, 'photoAvailability': 'not_found'}
        updated = apply_video_frames(proof, self.review, self.model, self.parent, hf_url)
        self.assertEqual(updated['sceneManifest'], model_receipt)
        self.assertEqual(proof['photoAvailability'], 'not_found')
        self.assertEqual(updated['photoAvailability'], 'video_frames')
        self.assertEqual(updated['availableData']['images'], {'status': 'listed', 'count': 28, 'sourceFormat': 'video'})
        self.assertIn('remaining camera pixels', updated['scope'])


if __name__ == '__main__':
    unittest.main()
