import copy
import json
import unittest

from scripts.catalog.archive_routing import archive_reviews, archive_asset, apply_archive_routing
from scripts.catalog.photo_routing import selection_digest, routing_coverage
from scripts.catalog.build_individual_catalog import hf_url


class ArchiveRoutingTests(unittest.TestCase):
    def setUp(self):
        self.entry = {'sourceId': 'hf:owner/data', 'provider': 'huggingface', 'access': 'public',
            'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        self.files = {'cameras': 'scene/sparse/0/cameras.bin', 'images': 'scene/sparse/0/images.bin', 'points3d': 'scene/sparse/0/points3D.bin'}
        self.item = {'sourceId': 'hf:owner/data', 'revision': 'a' * 40, 'kind': 'colmap', 'path': 'scene/sparse/0',
            'files': self.files, 'sourceViewerUrl': 'https://colmapview.opsiclear.com/?url=native',
            'viewerVersion': '0.19.2', 'viewerCommit': 'b' * 40, 'checkedAt': '2026-10-19',
            'archive': {'path': 'photos/capture.tar', 'format': 'tar', 'bytes': 8192, 'mountPath': 'images/dslr_images_undistorted',
                'stripPrefix': 'capture', 'photosLowerBound': 1},
            'sample': {'memberPath': 'capture/a.png', 'registeredName': 'dslr_images_undistorted/a.png',
                'mountedPath': 'images/dslr_images_undistorted/a.png', 'sha256': 'c' * 64, 'width': 80, 'height': 60},
            'checks': dict.fromkeys(('nameSampleMatched', 'sampleDimensionsMatch', 'browserRangeRead', 'manifestBinding', 'modelSelectionPreserved'), True)}
        self.proof = {'level': 'native_layout_checked', 'viewerUrl': self.item['sourceViewerUrl'], 'photoAvailability': 'companion_archive',
            'sceneCompatibility': {'images': 5, 'cameras': 1, 'points': 23},
            'availableData': {'cameras': {'status': 'checked'}, 'point_cloud': {'status': 'checked', 'count': 23}},
            'photoAudit': {'archive': {'path': 'photos/capture.tar', 'format': 'tar', 'nameSampleMatched': True,
                'browserRangeRead': True, 'sample': {'dimensionsMatch': True}}},
            'thumbnail': {'sourceArchive': 'photos/capture.tar', 'sourceSha256': 'c' * 64,
                'registeredName': 'dslr_images_undistorted/a.png', 'originalWidth': 80, 'originalHeight': 60}}

    def review(self):
        self.item['selectionSha256'] = selection_digest(self.item)
        return next(iter(archive_reviews({'entries': [self.entry]}, {'schemaVersion': 1, 'checkedAt': '2026-10-19', 'scenes': [self.item]}).values()))

    def apply(self):
        return apply_archive_routing(self.entry, ['colmap', 'scene/sparse/0', self.files, None], 'a' * 40, self.proof, self.review(), hf_url)

    def test_manifest_mounts_the_capture_without_changing_the_selected_model(self):
        _, body = archive_asset(self.review(), self.entry, hf_url)
        manifest = json.loads(body)
        self.assertEqual(manifest['version'], 2)
        self.assertEqual(manifest['files']['points3D'], hf_url(self.entry, 'a' * 40, self.files['points3d']))
        self.assertEqual(manifest['mediaArchives'][0]['stripPrefix'], 'capture')
        self.assertEqual(manifest['imageNameToPath'], {'dslr_images_undistorted/a.png': 'images/dslr_images_undistorted/a.png'})
        self.assertNotIn('images', manifest)
        self.assertNotIn('splats', manifest)

    def test_archive_route_retains_counts_photos_and_existing_export_tier(self):
        result = self.apply()
        self.assertEqual(result['sceneCompatibility'], self.proof['sceneCompatibility'])
        self.assertEqual(result['availableData'], self.proof['availableData'])
        self.assertEqual(result['photoAvailability'], 'companion_archive')
        self.assertNotIn('sceneManifest', result)
        self.assertEqual(routing_coverage(result, 'colmap')['launchRouting'], 'photo_archive_manifest')

    def test_changed_archive_selection_photo_bytes_or_calibration_cannot_inherit_binding(self):
        original = copy.deepcopy(self.proof)
        for mutate in [lambda p: p.update(viewerUrl='different'), lambda p: p['thumbnail'].update(sourceSha256='e' * 64),
                lambda p: p['thumbnail'].update(originalWidth=160), lambda p: p['photoAudit']['archive']['sample'].update(dimensionsMatch=False),
                lambda p: p.update(sceneValidation={'status': 'passed'})]:
            self.proof = copy.deepcopy(original)
            mutate(self.proof)
            with self.assertRaises(ValueError):
                self.apply()

    def test_a_different_capture_prefix_or_model_pin_is_rejected(self):
        self.item['archive']['stripPrefix'] = 'peer'
        with self.assertRaisesRegex(ValueError, 'prefix'):
            self.review()
        self.item['archive']['stripPrefix'] = 'capture'
        self.item['revision'] = 'c' * 40
        with self.assertRaisesRegex(ValueError, 'pinned'):
            self.review()
