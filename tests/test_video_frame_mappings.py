import copy
import hashlib
import json
import unittest

from scripts.catalog.build_individual_catalog import hf_url
from scripts.catalog.scene_manifests import json_bytes
from scripts.catalog.scene_qualification import scene_key
from scripts.catalog.video_frames import review_digest
from scripts.catalog.video_frame_mappings import CHECKS, apply_mapping, base_manifest, mapping_assets, mapping_reviews
from scripts.audit.record_video_frame_mapping import checked_mapping


class VideoFrameMappingTests(unittest.TestCase):
    def setUp(self):
        self.parent = {'sourceId': 'hf:owner/data', 'provider': 'huggingface', 'access': 'public'}
        self.model = {'sourceId': self.parent['sourceId'], 'revision': 'a' * 40, 'kind': 'colmap', 'path': 'scene/sparse/0',
                      'files': {'cameras': 'scene/sparse/0/cameras.bin', 'images': 'scene/sparse/0/images.bin', 'points3d': 'scene/sparse/0/points3D.bin'},
                      'cameras': 1, 'images': 2, 'points': 3, 'photos': 'not_checked'}
        self.key = scene_key(self.model['sourceId'], self.model['kind'], self.model['path'])
        self.review = {**{field: self.model[field] for field in ('sourceId', 'revision', 'kind', 'path')},
                       'manifestVersion': 5,
                       'baseManifestSha256': hashlib.sha256(json_bytes(base_manifest(self.model, self.parent, hf_url))).hexdigest(),
                       'modelFiles': {role: {'sourcePath': path, 'bytes': 100, 'sha256': 'b' * 64} for role, path in self.model['files'].items()},
                       'registeredImages': [{'name': name, 'cameraId': 7, 'width': 64, 'height': 80} for name in ('cam/a.jpg', 'cam/b.jpg')],
                       'videos': [{'id': 'recording', 'sourcePath': 'videos/camera.mp4', 'bytes': 300000000, 'sha256': 'c' * 64,
                                   'width': 64, 'height': 80, 'frameCount': 30, 'duration': 7.3}],
                       'bindings': [{'name': name, 'video': 'recording', 'frameIndex': index} for name, index in [('cam/a.jpg', 0), ('cam/b.jpg', 17)]],
                       'samples': [{'name': 'cam/a.jpg', 'video': 'recording', 'frameIndex': 0, 'sourceTimestamp': 0.25, 'bytes': 50,
                                    'sha256': 'd' * 64, 'referenceSha256': 'e' * 64, 'maxPixelDifference': 0, 'meanPixelDifference': 0}],
                       'temporalScope': 'per_pose', 'checkedAt': '2026-10-24T12:00:00Z', 'viewerVersion': '0.23.0', 'viewerCommit': 'e' * 40,
                       'checks': {check: 'passed' for check in CHECKS}}

    def validate(self, review=None):
        review = copy.deepcopy(review or self.review)
        review['receiptSha256'] = review_digest(review)
        return mapping_reviews({'entries': [self.parent]}, {'schemaVersion': 1, 'scenes': [review]}, {self.key: self.model}, {}, hf_url)

    def test_many_registered_views_share_a_video_without_relabeling_model_export_evidence(self):
        review = self.validate()[self.key]
        assets = mapping_assets(review, self.model, self.parent, hf_url)
        self.assertEqual(len(assets), 2)
        for name, body in assets.items():
            self.assertEqual(name, hashlib.sha256(body).hexdigest() + '.manifest.json')
        current = next(json.loads(body) for body in assets.values() if json.loads(body)['version'] == 5)
        self.assertEqual(current['videoImages']['cam/b.jpg']['frameIndex'], 17)
        self.assertEqual(len({item['url'] for item in current['videoImages'].values()}), 1)
        self.assertNotIn('skipImages', current)
        proof = {'scope': 'Native source counts checked.', 'sceneCompatibility': {'images': 2},
                 'sourceIntegrityReview': {'status': 'inconsistent'}, 'availableData': {}}
        updated = apply_mapping(proof, review, self.model, self.parent, hf_url)
        self.assertEqual(updated['videoFrameMapping']['mappedImages'], 2)
        self.assertEqual(updated['videoFrameMapping']['videoSources'], 1)
        self.assertEqual(updated['sourceIntegrityReview'], proof['sourceIntegrityReview'])
        self.assertNotIn('sceneManifest', updated)
        self.assertNotIn('exportSha256', updated['videoFrameMapping'])

    def test_partial_coverage_is_counted_without_claiming_all_registered_photos(self):
        review = copy.deepcopy(self.review)
        review['bindings'].pop()
        checked = self.validate(review)[self.key]
        updated = apply_mapping({'scope': '', 'availableData': {}}, checked, self.model, self.parent, hf_url)
        self.assertEqual(updated['photoAvailability'], 'partial')
        self.assertEqual(updated['photoAudit']['nameCheck']['missing'], 1)

    def test_generic_timestamp_mapping_retains_the_v4_runtime_contract(self):
        review = copy.deepcopy(self.review)
        review['manifestVersion'] = 4
        for binding in review['bindings']:
            binding['timestamp'] = binding.pop('frameIndex') / 10
        review['samples'][0]['timestamp'] = review['samples'][0].pop('frameIndex') / 10
        checked = self.validate(review)[self.key]
        assets = mapping_assets(checked, self.model, self.parent, hf_url)
        current = next(json.loads(body) for body in assets.values() if json.loads(body)['version'] == 4)
        self.assertEqual(current['videoImages']['cam/b.jpg']['timestamp'], 1.7)
        self.assertEqual(apply_mapping({'scope': ''}, checked, self.model, self.parent, hf_url)['videoFrameMapping']['manifestVersion'], 4)
        review['bindings'][0] = {'name': 'cam/a.jpg', 'video': 'recording', 'frameIndex': 0}
        with self.assertRaises(ValueError): self.validate(review)

    def test_recorder_binds_independent_samples_and_excludes_local_paths(self):
        prepared = copy.deepcopy(self.review)
        sample = prepared['samples'][0]
        sample['sha256'] = sample.pop('referenceSha256')
        sample['referenceFile'] = 'C:/private/scratch/reference.png'
        pixels = {'status': 'passed', 'viewerCommit': 'e' * 40, 'checkedAt': self.review['checkedAt'], 'total': 1,
                  'samples': [{**self.review['samples'][0], 'status': 'passed', 'decodePath': 'software', 'colorComparison': 'unmanaged_rgba'}]}
        result = checked_mapping(prepared, pixels, 'e' * 40, '0.23.0')
        self.assertNotIn('referenceFile', result['samples'][0])
        self.assertEqual(result['receiptSha256'], review_digest(result))
        for changed in ({'viewerCommit': 'f' * 40}, {'status': 'failed'}, {'samples': []}):
            with self.subTest(change=changed):
                with self.assertRaises(ValueError): checked_mapping(prepared, {**pixels, **changed}, 'e' * 40, '0.23.0')

    def test_invalid_identity_selectors_dimensions_sources_and_samples_cannot_inherit_evidence(self):
        def revision(review): review['revision'] = 'f' * 40
        def base(review): review['baseManifestSha256'] = 'f' * 64
        def model_path(review): review['modelFiles']['images']['sourcePath'] = 'other/images.bin'
        def coverage(review): review['registeredImages'].pop()
        def wrong_camera(review): review['registeredImages'][0]['width'] = 65
        def unknown_name(review): review['bindings'][0]['name'] = 'other.jpg'
        def invalid_index(review): review['bindings'][0]['frameIndex'] = 30
        def both(review): review['bindings'][0]['timestamp'] = 0
        def ignored_null(review): review['bindings'][0].update(frameIndex=None, timestamp=0)
        def duplicate_source(review): review['videos'].append({**review['videos'][0], 'id': 'duplicate'})
        def sample(review): review['samples'] = []
        for edit in (revision, base, model_path, coverage, wrong_camera, unknown_name, invalid_index, both, ignored_null, duplicate_source, sample):
            with self.subTest(change=edit.__name__):
                review = copy.deepcopy(self.review)
                edit(review)
                with self.assertRaises(ValueError): self.validate(review)


if __name__ == '__main__':
    unittest.main()
