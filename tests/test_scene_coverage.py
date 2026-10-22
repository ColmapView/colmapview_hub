import copy
import hashlib
import json
import unittest
from urllib.parse import quote

from scripts.audit.prepare_individual_datasets import individual_records
from scripts.catalog.build_individual_catalog import can_open_scene, hf_url
from scripts.catalog.scene_qualification import (MODEL_CHECKS, LAUNCH_ASSETS, launch_manifest_asset,
    native_evidence, native_launch_manifest, native_scene_reviews, qualified_evidence, source_snapshot, verified_scene_reviews)
from scripts.catalog.scene_photos import photo_scene_reviews


class SceneCoverageTests(unittest.TestCase):
    def setUp(self):
        self.entry = {'sourceId': 'hf:owner/data', 'provider': 'huggingface', 'access': 'public',
                      'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        self.files = {'cameras': 'capture/sparse/0/cameras.bin', 'images': 'capture/sparse/0/images.bin'}
        self.model = ['capture/sparse/0', self.files, 1, 35, 0, 'not_checked', '2026-10-19',
                      {'cameraRecordChecked': True, 'poseRecordChecked': True, 'pointFileAbsentChecked': True}]

    def native(self, model=None):
        policy = {'schemaVersion': 1, 'sources': [{'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'models': [model or self.model]}]}
        return next(iter(native_scene_reviews({'entries': [self.entry]}, policy).values()))

    def test_camera_only_models_qualify_with_checked_point_absence(self):
        review = self.native()
        row = ['cameras', self.model[0], self.files, None]
        proof, format_ = native_evidence(self.entry, row, 'a' * 40, review, hf_url)
        self.assertTrue(can_open_scene(self.entry, row, proof))
        self.assertEqual(proof['sceneCompatibility']['points'], 0)
        self.assertEqual(format_, 'COLMAP cameras and poses')
        self.assertNotIn('sceneValidation', proof)
        self.assertNotIn('point-file headers checked', proof['summary'])
        for change in ('absent', 'nonzero'):
            broken = copy.deepcopy(self.model)
            if change == 'absent':
                broken[7].pop('pointFileAbsentChecked')
            else:
                broken[4] = 1
            with self.subTest(change), self.assertRaises(ValueError):
                self.native(broken)

    def test_native_photo_prefix_manifest_keeps_exact_files_and_registered_names(self):
        review = self.native()
        review['imagePrefix'] = {'path': 'capture/images', 'registeredName': 'a.jpg', 'samplePath': 'capture/images/a.jpg',
                                'samplePrefixSha256': 'c' * 64, 'browserRead': True, 'dimensionsMatch': True, 'orientation': 1}
        manifest = native_launch_manifest(self.entry, review, hf_url)
        self.assertNotIn('points3D', manifest['files'])
        self.assertEqual(manifest['imagesPath'], hf_url(self.entry, 'a' * 40, 'capture/images') + '/')
        self.assertEqual(manifest['baseUrl'], LAUNCH_ASSETS)
        name, body = launch_manifest_asset(manifest)
        self.assertEqual(json.loads(body), manifest)
        proof, _ = native_evidence(self.entry, ['cameras', self.model[0], self.files, None], 'a' * 40, review, hf_url)
        self.assertIn(LAUNCH_ASSETS.replace(':', '%3A').replace('/', '%2F'), proof['viewerUrl'])
        self.assertTrue(proof['viewerUrl'].endswith(name))
        for field, value in [('path', '../images'), ('samplePath', 'other/a.jpg'), ('orientation', 6), ('dimensionsMatch', False)]:
            broken = copy.deepcopy(review); broken['imagePrefix'][field] = value
            with self.subTest(field), self.assertRaises(ValueError):
                native_launch_manifest(self.entry, broken, hf_url)

    def test_unresolved_photos_can_be_skipped_without_changing_native_files(self):
        model = copy.deepcopy(self.model)
        model[5] = 'unresolved'
        model[7]['skipImages'] = True
        review = self.native(model)
        manifest = native_launch_manifest(self.entry, review, hf_url)
        self.assertTrue(manifest['skipImages'])
        self.assertEqual(manifest['images'], [])
        self.assertEqual(manifest['masks'], [])
        self.assertEqual(manifest['splats'], [])
        self.assertNotIn('imagesPath', manifest)
        self.assertEqual(manifest['files'], {role: hf_url(self.entry, 'a' * 40, path) for role, path in self.files.items()})
        proof, _ = native_evidence(self.entry, ['cameras', model[0], self.files, None], 'a' * 40, review, hf_url)
        self.assertIn(launch_manifest_asset(manifest)[0], proof['viewerUrl'])
        self.assertEqual(proof['photoAvailability'], 'unresolved')

    def test_skipping_photos_cannot_conflict_with_a_checked_prefix_or_photo_status(self):
        for change in ('value', 'status', 'prefix'):
            model = copy.deepcopy(self.model)
            model[5] = 'unresolved'
            model[7]['skipImages'] = True
            if change == 'value':
                model[7]['skipImages'] = 'true'
            elif change == 'status':
                model[5] = 'sample_checked'
            else:
                model[7]['imagePrefix'] = {'path': 'capture/images'}
            with self.subTest(change), self.assertRaisesRegex(ValueError, 'unresolved photo review'):
                self.native(model)

    def model_review(self, public=False):
        path = 'capture/transforms.json'
        url = hf_url(self.entry, 'a' * 40, path)
        if public:
            self.entry.update(sourceId='public:example', provider='public', dataUrl='https://example.org/' + 'a' * 40 + '/transforms.json')
            url = self.entry['dataUrl']; path = url
        return {'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'kind': 'scene' if public else 'camera-scene',
                'path': 'capture', 'files': {'metadata': path}, 'loadPath': path, 'loadUrl': url,
                'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + quote(url, safe=''),
                'counts': {'cameras': 1, 'images': 35, 'points': 0}, 'photos': [], 'export': 'colmap_model',
                'checks': {key: 'passed' for key in MODEL_CHECKS}, 'checkedAt': '2026-10-19', 'viewerVersion': '0.17.7',
                'viewerCommit': 'b' * 40, 'exportSha256': 'c' * 64,
                'sourceFiles': [{'path': path, 'url': url, 'bytes': 100, 'sha256': 'd' * 64, 'browserRead': True}]}

    def verify(self, review):
        return verified_scene_reviews({'entries': [self.entry]}, {'schemaVersion': 1, 'scenes': [review]})

    def test_metadata_model_exports_do_not_claim_original_photos(self):
        review = self.model_review()
        review['files'] = {'metadata:capture/transforms.json': review['loadPath']}
        self.verify(review)
        row = ['camera-scene', review['path'], review['files'], None]
        proof, _ = qualified_evidence(self.entry, row, 'a' * 40, review, hf_url)
        self.assertTrue(can_open_scene(self.entry, row, proof))
        self.assertEqual(proof['photoAvailability'], 'not_checked')
        self.assertEqual(proof['sceneValidation']['export'], 'colmap_model')
        for field in MODEL_CHECKS:
            broken = copy.deepcopy(review); broken['checks'].pop(field)
            with self.subTest(field), self.assertRaises(ValueError):
                self.verify(broken)
        for mutate in (lambda row: row['sourceFiles'].clear(), lambda row: row['sourceFiles'][0].update(url='https://example.org/other'),
                       lambda row: row['sourceFiles'][0].update(bytes=True), lambda row: row.update(export='colmap_images')):
            broken = copy.deepcopy(review); mutate(broken)
            with self.assertRaises(ValueError):
                self.verify(broken)

    def test_public_metadata_requires_a_bound_snapshot_and_exact_launch(self):
        review = self.model_review(public=True)
        review['sourceSnapshotSha256'] = source_snapshot(review['sourceFiles'])
        self.verify(review)
        row = ['scene', review['path'], review['files'], None]
        proof, _ = qualified_evidence(self.entry, row, 'a' * 40, review, hf_url)
        self.assertTrue(can_open_scene(self.entry, row, proof))
        broken = copy.deepcopy(review); broken['sourceSnapshotSha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'snapshot'):
            self.verify(broken)
        broken = copy.deepcopy(review); broken['loadUrl'] = 'https://example.org/model.ply'
        with self.assertRaises(ValueError):
            qualified_evidence(self.entry, row, 'a' * 40, broken, hf_url)

    def test_public_native_manifest_requires_all_original_bytes_and_its_own_content_hash(self):
        review = self.model_review(public=True)
        review['files'] = {role: 'https://example.org/model/' + role + '.bin' for role in ('cameras', 'images', 'points3d')}
        manifest = {'version': 1, 'baseUrl': LAUNCH_ASSETS, 'files': {'cameras': review['files']['cameras'],
                    'images': review['files']['images'], 'points3D': review['files']['points3d']},
                    'imagesPath': 'https://example.org/photos/', 'splats': []}
        name, body = launch_manifest_asset(manifest)
        url = LAUNCH_ASSETS + name
        review['files']['manifest'] = url
        review.update(launchManifest=manifest, loadPath=url, loadUrl=url, viewerUrl='https://colmapview.opsiclear.com/?url=' + quote(url, safe=''),
                      sourceFiles=[{'path': path, 'url': path, 'bytes': 100, 'sha256': 'd' * 64, 'browserRead': True} for path in review['files'].values()])
        review['sourceFiles'][-1].update(bytes=len(body), sha256=hashlib.sha256(body).hexdigest())
        review['revision'] = review['sourceSnapshotSha256'] = source_snapshot(review['sourceFiles'])
        self.entry['facts'][0]['value'] = review['revision']; self.entry['dataUrl'] = url
        self.verify(review)
        for mutate in (lambda r: r['sourceFiles'].pop(0), lambda r: r['sourceFiles'][-1].update(bytes=1),
                       lambda r: r['launchManifest']['files'].update(cameras='https://example.org/other.bin'),
                       lambda r: r.update(revision='f' * 64)):
            broken = copy.deepcopy(review); mutate(broken)
            broken['sourceSnapshotSha256'] = source_snapshot(broken['sourceFiles'])
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.verify(broken)

    def test_partial_frames_and_nonempty_model_exports_need_their_own_checks(self):
        review = self.model_review()
        review['frameCoverage'] = {'metadataFrames': 40, 'missingRgbFrames': 5, 'listingComplete': True, 'listingBrowserRead': True,
            'listingUrl': 'https://huggingface.co/api/datasets/owner/data/tree/' + 'a' * 40 + '/capture', 'listingSha256': 'f' * 64}
        self.verify(review)
        for field, value in [('missingRgbFrames', 6), ('listingComplete', False), ('listingBrowserRead', False),
                             ('listingUrl', 'https://huggingface.co/api/datasets/other/data/tree/' + 'a' * 40 + '/capture')]:
            broken = copy.deepcopy(review); broken['frameCoverage'][field] = value
            with self.subTest(field), self.assertRaises(ValueError):
                self.verify(broken)
        review['counts']['points'] = 4
        with self.assertRaisesRegex(ValueError, 'point value'):
            self.verify(review)
        review['checks']['pointValues'] = 'passed'
        with self.assertRaisesRegex(ValueError, 'Companion points'):
            self.verify(review)
        path = 'capture/points_gt.ply'
        review['files']['asset:' + path] = path
        review['companionPointCloud'] = path
        with self.assertRaisesRegex(ValueError, 'receipt'):
            self.verify(review)
        review['sourceFiles'].append({'path': path, 'url': hf_url(self.entry, 'a' * 40, path),
                                      'bytes': 100, 'sha256': 'e' * 64, 'browserRead': True})
        self.verify(review)
        for field, value in [('companionPointCloud', 'capture/mesh.obj'), ('counts', {**review['counts'], 'points': 0})]:
            broken = copy.deepcopy(review); broken[field] = value
            with self.subTest(field), self.assertRaisesRegex(ValueError, 'Companion points'):
                self.verify(broken)

    def test_discovery_records_all_supported_camera_filename_families(self):
        names = ['transforms.json', 'cameras.json', 'reconstruction.json', 'reconstruction_example.json',
                 'sfm_data.json', 'bundle.out', 'poses_bounds.npy', 'cameras_sphere.npz']
        rows = individual_records(['scene/' + name for name in names] + ['objects/file.ply'])
        self.assertEqual({row[1] for row in rows if row[0] == 'camera-metadata'}, {'scene/' + name for name in names})

    def test_unknown_inventory_and_positive_exact_samples_have_distinct_requirements(self):
        audit = {'status': 'not_checked', 'policy': 'photo_inventory_pending', 'listingComplete': False,
                 'checkedAt': '2026-10-19', 'summary': 'Image availability remains unknown.'}
        policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'sources': [{'sourceId': self.entry['sourceId'],
                  'revision': 'a' * 40, 'scenes': [{'kind': 'cameras', 'path': self.model[0], 'files': self.files, 'audit': audit}]}]}
        photo_scene_reviews({'entries': [self.entry]}, policy)
        audit.update(status='sample_checked', policy='exact_registered_sample', samplePath='capture/images/a.jpg',
                     sampleRegisteredName='a.jpg', samplePrefixSha256='c' * 64, sampleDimensionsMatch=True,
                     sampleBrowserRead=True, samplePixels='deferred')
        photo_scene_reviews({'entries': [self.entry]}, policy)
        audit['sampleDimensionsMatch'] = False
        with self.assertRaises(ValueError):
            photo_scene_reviews({'entries': [self.entry]}, policy)
        audit['status'] = 'path_policy_required'
        photo_scene_reviews({'entries': [self.entry]}, policy)
