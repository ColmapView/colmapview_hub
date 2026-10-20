import copy
import hashlib
import json
import unittest

from scripts.catalog.build_individual_catalog import hf_url
from scripts.catalog.scene_manifests import (ASSET_BASE, CHECKS, apply_manifest_evidence, manifest_assets,
                             manifest_scene_reviews, selection_digest)


class SceneManifestTests(unittest.TestCase):
    def setUp(self):
        self.entry = {'sourceId': 'hf:owner/data', 'provider': 'huggingface', 'access': 'public',
                      'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        self.files = {'cameras': 'scene/sparse_mast3r/cameras.bin', 'images': 'scene/sparse_mast3r/images.bin',
                      'points3d': 'scene/sparse_mast3r/points3D.txt',
                      'asset:scene/sparse_mast3r/points3D.ply': 'scene/sparse_mast3r/points3D.ply'}
        receipt = lambda path: {'sourcePath': path, 'sha256': 'b' * 64, 'bytes': 100}
        self.review = {'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'kind': 'colmap', 'path': 'scene/sparse_mast3r',
            'files': self.files, 'modelFiles': {role: receipt(self.files[role]) for role in ('cameras', 'images')},
            'points': {**receipt('scene/sparse_mast3r/points3D.ply'), 'format': 'xyz_ply', 'count': 42},
            'counts': {'cameras': 1, 'images': 1, 'points': 42},
            'photos': [{**receipt('scene/images/cam/a.png'), 'name': 'cam/a.png', 'width': 80, 'height': 60}],
            'masks': [{**receipt('scene/mask/cam/a.png'), 'name': 'cam/a.png', 'width': 80, 'height': 60}], 'maskRole': 'unknown',
            'viewerState': {'version': 1, 'viewerVersion': '0.17.5', 'viewState': {'position': [2, 3, 4],
                'target': [0, 0, 0], 'quaternion': [0, 0, 0, 1], 'distance': 5},
                'config': {'pointCloud': {'showPointCloud': True, 'minTrackLength': 0}}},
            'checkedAt': '2026-10-18', 'viewerVersion': '0.17.5', 'viewerCommit': 'c' * 40, 'exportSha256': 'd' * 64,
            'checks': {key: 'passed' for key in (*CHECKS, 'photoDecode', 'maskDecode', 'originalPhotoHashes')}}
        self.bind()
        self.proof = {'level': 'native_layout_checked', 'viewerUrl': 'old-model-url',
            'sceneCompatibility': {'cameras': 1, 'images': 1, 'points': 0}, 'photoAvailability': 'path_policy_required',
            'availableData': {'cameras': {'status': 'checked'}, 'images': {'status': 'needs_setup'}}}
        self.row = ['colmap', self.review['path'], self.files, None]

    def bind(self):
        self.review['selectionSha256'] = selection_digest(self.review)

    def reviews(self):
        return manifest_scene_reviews({'entries': [self.entry]}, {'schemaVersion': 1, 'checkedAt': '2026-10-18', 'scenes': [self.review]})

    def test_manifest_selects_ply_without_mutating_native_counts_and_binds_sibling_media(self):
        self.reviews()
        assets = manifest_assets(self.review, self.entry, hf_url)
        manifest = json.loads(assets[self.review['selectionSha256'] + '.manifest.json'])
        self.assertEqual(manifest['version'], 1)
        self.assertEqual(manifest['baseUrl'], ASSET_BASE)
        self.assertTrue(manifest['files']['cameras'].endswith('/scene/sparse_mast3r/cameras.bin'))
        self.assertTrue(manifest['files']['points3D'].endswith('/points3D.ply'))
        self.assertTrue(manifest['imageNameToPath']['cam/a.png'].endswith('/scene/images/cam/a.png'))
        self.assertTrue(manifest['maskNameToPath']['cam/a.png'].endswith('/scene/mask/cam/a.png'))
        state = json.loads(assets[manifest['viewerStatePath']])
        self.assertEqual(state['config']['pointCloud']['minTrackLength'], 0)
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['sceneCompatibility']['points'], 0)
        self.assertEqual(updated['sceneManifest']['counts']['points'], 42)
        self.assertEqual(updated['availableData']['images'], {'status': 'checked', 'count': 1})
        self.assertEqual(updated['photoAvailability'], 'complete_export_checked')
        self.assertEqual(self.proof['viewerUrl'], 'old-model-url')
        self.assertEqual(updated['sceneManifest']['sha256'], hashlib.sha256(assets[self.review['selectionSha256'] + '.manifest.json']).hexdigest())

    def test_unbound_selection_edits_fail_until_reaudited(self):
        self.review['photos'][0]['sourcePath'] = 'other/images/cam/a.png'
        with self.assertRaisesRegex(ValueError, 'selection-bound'):
            self.reviews()

    def test_full_scene_manifest_retains_prior_photo_routing_evidence(self):
        routing = {'url': 'https://source.invalid/old-photo.manifest.json', 'mappedNames': 1}
        self.proof['photoRouting'] = routing
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['priorPhotoRouting'], routing)
        self.assertNotIn('photoRouting', updated)
        self.assertTrue(updated['viewerUrl'].endswith(self.review['selectionSha256'] + '.manifest.json'))
        self.assertEqual(updated['photoAvailability'], 'complete_export_checked')

    def sibling_association(self, method='identical_poses'):
        self.review['path'] = 'scene/sparse_seed'
        self.files.clear()
        self.files.update({role: 'scene/sparse_seed/' + role + '.txt' for role in ('cameras', 'images')})
        self.review['modelFiles'] = {role: {'sourcePath': path, 'bytes': 10, 'sha256': 'a' * 64}
                                     for role, path in self.files.items()}
        self.row[:3] = ['colmap', self.review['path'], self.files]
        association = {'sceneRoot': 'scene', 'method': method, 'referenceModel': {
            role: {'sourcePath': 'scene/sparse_mast3r/' + role + '.bin', 'bytes': 100, 'sha256': 'b' * 64}
            for role in ('cameras', 'images')}}
        if method == 'identical_poses':
            association.update(matchedImages=1, maxPoseDelta=0)
        else:
            association.update(matchedCameras=1, maxCalibrationDelta=0,
                declaration={'sourcePath': 'README.md', 'bytes': 100, 'sha256': 'e' * 64,
                             'statement': 'share the same world coordinate system'})
        self.review['pointAssociation'] = association
        self.review['checks']['pointAssociation'] = 'passed'
        self.bind()

    def test_sibling_clouds_require_a_selection_bound_world_association(self):
        for method in ('identical_poses', 'publisher_shared_world'):
            with self.subTest(method=method):
                self.sibling_association(method)
                self.reviews()
                updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
                self.assertEqual(updated['sceneManifest']['counts']['points'], 42)
                self.assertEqual(updated['sceneManifest']['pointAssociation']['method'], method)
                self.assertEqual(updated['sceneCompatibility']['points'], 0)
        self.review['pointAssociation']['declaration']['sha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'selection-bound'):
            self.reviews()

    def test_unproven_sibling_worlds_and_collection_wide_scopes_fail(self):
        self.sibling_association()
        original = copy.deepcopy(self.review)
        changes = [lambda r: r['pointAssociation'].update(sceneRoot='other'),
                   lambda r: r['pointAssociation'].update(sceneRoot='scene/sparse_seed'),
                   lambda r: r['pointAssociation'].update(method='same_basename'),
                   lambda r: r['pointAssociation'].update(matchedImages=0),
                   lambda r: r['pointAssociation'].update(maxPoseDelta=0.1),
                   lambda r: r['pointAssociation'].update(maxPoseDelta=float('nan')),
                   lambda r: r['pointAssociation']['referenceModel']['images'].update(sourcePath='other/images.bin'),
                   lambda r: r['pointAssociation']['referenceModel'].pop('cameras'),
                   lambda r: r['checks'].update(pointAssociation='not_checked')]
        for change in changes:
            self.review = copy.deepcopy(original)
            change(self.review)
            with self.assertRaises(ValueError):
                self.bind(); self.reviews()
        self.review = original
        self.proof['sceneCompatibility']['points'] = 1
        with self.assertRaisesRegex(ValueError, 'exact empty native'):
            apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)

    def test_native_cloud_transforms_cannot_be_accepted_and_silently_ignored(self):
        self.review['points']['transform'] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        self.bind()
        with self.assertRaisesRegex(ValueError, 'already aligned'):
            self.reviews()

    def test_native_tracks_bind_only_to_an_empty_identical_camera_model(self):
        self.sibling_association()
        self.review['points'].update(sourcePath='scene/sparse_mast3r/points3D.bin', format='colmap_binary')
        association = self.review['pointAssociation']
        association.update(method='identical_native_model', matchedCameras=1, maxCalibrationDelta=0,
                           identityIds='matched', sourceFeatures=0)
        self.review['checks'].update(trackValues='passed', sourceCameraIdentity='passed')
        self.bind(); self.reviews()
        assets = manifest_assets(self.review, self.entry, hf_url)
        manifest = json.loads(assets[self.review['selectionSha256'] + '.manifest.json'])
        self.assertTrue(manifest['files']['cameras'].endswith('/scene/sparse_seed/cameras.txt'))
        self.assertTrue(manifest['files']['images'].endswith('/scene/sparse_mast3r/images.bin'))
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['sceneManifest']['pointFormat'], 'colmap_binary')
        original = copy.deepcopy(self.review)
        for changes in [{'sourceFeatures': 1}, {'identityIds': 'different'}, {'maxCalibrationDelta': 0.1},
                        {'matchedCameras': 2}, {'matchedImages': 2}]:
            self.review = copy.deepcopy(original)
            self.review['pointAssociation'].update(changes)
            self.bind()
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'identical cameras'):
                self.reviews()
        self.review = original
        self.proof['sceneCompatibility']['points'] = 1
        with self.assertRaisesRegex(ValueError, 'preserve native points'):
            apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)

    def test_camera_only_cloud_binding_preserves_checked_photo_prefix_and_evidence_tier(self):
        self.review.update(kind='cameras', photos=[], masks=[])
        self.files.pop('points3d')
        image = {'path': 'scene/images/', 'registeredName': 'cam/a.png', 'samplePath': 'scene/images/cam/a.png',
                 'samplePrefixSha256': 'e' * 64, 'browserRead': True, 'dimensionsMatch': True, 'orientation': 1}
        self.review['imagePrefix'] = image
        self.row[0] = 'cameras'
        self.proof.update(photoAvailability='sample_checked', photoAudit={'status': 'sample_checked',
            'sampleRegisteredName': image['registeredName'], 'samplePath': image['samplePath'], 'samplePrefixSha256': image['samplePrefixSha256']})
        self.proof['availableData']['images'] = {'status': 'checked'}
        self.bind(); self.reviews()
        manifest = json.loads(manifest_assets(self.review, self.entry, hf_url)[self.review['selectionSha256'] + '.manifest.json'])
        self.assertFalse(manifest['skipImages'])
        self.assertTrue(manifest['imagesPath'].endswith('/scene/images/'))
        result, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(result['photoAudit'], self.proof['photoAudit'])
        self.assertEqual(result['photoAvailability'], 'sample_checked')
        self.assertEqual(result['sceneManifest']['photoCount'], 0)
        self.review['imagePrefix']['samplePrefixSha256'] = 'f' * 64
        with self.assertRaisesRegex(ValueError, 'previously checked'):
            apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)

    def metadata_review(self):
        self.review.update(kind='camera-scene', path='scene', photos=[], masks=[],
            files={'metadata:scene/transforms.json': 'scene/transforms.json', 'asset:scene/input.ply': 'scene/input.ply'},
            sourceCounts={'cameras': 1, 'images': 1, 'points': 0})
        self.review['modelFiles'] = {'metadata': {'sourcePath': 'scene/transforms.json', 'bytes': 100, 'sha256': 'b' * 64}}
        self.review['points']['sourcePath'] = 'scene/input.ply'
        self.row = ['camera-scene', 'scene', self.review['files'], None]
        self.bind()

    def test_metadata_manifest_keeps_source_world_transform_explicit_and_cameras_unchanged(self):
        self.metadata_review()
        matrix = [0, 1, 0, 0, 1, 0, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]
        self.review['points']['transform'] = matrix
        self.review['modelFiles']['referenceCameras'] = {'sourcePath':'scene/cameras.json','bytes':100,'sha256':'f'*64}
        self.review['checks']['worldTransform'] = 'passed'
        self.bind(); self.reviews()
        manifest = json.loads(manifest_assets(self.review, self.entry, hf_url)[self.review['selectionSha256'] + '.manifest.json'])
        self.assertEqual(manifest['format'], 'colmapview-camera-dataset')
        self.assertTrue(manifest['metadataUrl'].endswith('/scene/transforms.json'))
        self.assertEqual(manifest['pointCloud']['transform'], matrix)
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['sceneCompatibility']['points'], 0)
        self.assertEqual(updated['sceneManifest']['sourceCounts'], self.review['sourceCounts'])
        self.review['checks']['worldTransform'] = 'not_checked'; self.bind()
        with self.assertRaisesRegex(ValueError, 'independently verified'):
            self.reviews()

    def test_temporal_vertices_require_a_verified_explicit_array_and_matching_frame_subset(self):
        self.metadata_review()
        self.review['points'].update(sourcePath='scene/trajectory.npz', format='numpy_frame', array='pos', frame=0)
        self.review.update(frameIndices=[0], sourceCounts={'cameras': 2, 'images': 2, 'points': 0})
        self.review['checks']['temporalAlignment'] = 'passed'
        self.bind(); self.reviews()
        self.proof['sceneCompatibility'].update(cameras=2, images=2)
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['sceneManifest']['counts']['images'], 1)
        self.assertEqual(updated['sceneManifest']['sourceCounts']['images'], 2)
        self.assertEqual(updated['sceneManifest']['frameIndices'], [0])
        self.review['frameIndices'] = [2]; self.bind()
        with self.assertRaisesRegex(ValueError, 'frame subset'):
            self.reviews()

    def test_root_manifest_keeps_exact_native_files_when_nested_models_exist(self):
        self.files = {'cameras': 'cameras.bin', 'images': 'images.bin', 'points3d': 'points3D.bin',
                      'variant:sparse/0:cameras': 'sparse/0/cameras.bin',
                      'variant:sparse/0:images': 'sparse/0/images.bin',
                      'variant:sparse/0:points3d': 'sparse/0/points3D.bin'}
        self.review.update(path='', files=self.files)
        for role in ('cameras', 'images'):
            self.review['modelFiles'][role]['sourcePath'] = self.files[role]
        self.review['points'].update(sourcePath='points3D.bin', format='colmap_binary')
        self.proof['sceneCompatibility']['points'] = 42
        self.row = ['colmap', '', self.files, None]
        self.bind()
        self.reviews()
        assets = manifest_assets(self.review, self.entry, hf_url)
        manifest = json.loads(assets[self.review['selectionSha256'] + '.manifest.json'])
        self.assertEqual(manifest['name'], 'owner/data')
        for role, path in {'cameras': 'cameras.bin', 'images': 'images.bin', 'points3D': 'points3D.bin'}.items():
            self.assertEqual(manifest['files'][role], f'https://huggingface.co/datasets/owner/data/resolve/{"a" * 40}/{path}')
        updated, format_ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(format_, 'COLMAP')
        self.assertEqual(updated['sceneCompatibility']['points'], 42)
        self.assertEqual(updated['sceneManifest']['pointFormat'], 'colmap_binary')

    def test_root_support_does_not_allow_unsafe_scene_or_model_paths(self):
        original = copy.deepcopy(self.review)
        for path in (None, '/scene', '../scene', 'scene/../other', 'scene//other', 'scene\\other'):
            self.review = copy.deepcopy(original)
            self.review['path'] = path
            self.bind()
            with self.subTest(path=path), self.assertRaises(ValueError):
                self.reviews()

    def test_all_import_geometry_and_export_checks_are_required(self):
        for key in CHECKS:
            with self.subTest(key):
                self.review['checks'][key] = 'not_checked'
                with self.assertRaisesRegex(ValueError, 'checks must pass'):
                    self.reviews()
                self.review['checks'][key] = 'passed'

    def test_changed_revision_nonfinite_overview_and_track_filter_are_rejected(self):
        original = copy.deepcopy(self.review)
        for edit in [lambda r: r.update(revision='e' * 40),
                     lambda r: r['viewerState']['viewState']['target'].__setitem__(0, float('inf')),
                     lambda r: r['viewerState']['config']['pointCloud'].update(minTrackLength=2)]:
            self.review = copy.deepcopy(original)
            edit(self.review)
            with self.assertRaises(ValueError):
                self.bind()
                self.reviews()

    def test_duplicate_or_incomplete_photo_mapping_and_wrong_mask_size_fail(self):
        original = copy.deepcopy(self.review)
        for edit in [lambda r: r['photos'].append(copy.deepcopy(r['photos'][0])),
                     lambda r: r['counts'].update(images=0),
                     lambda r: r['masks'][0].update(width=81)]:
            self.review = copy.deepcopy(original)
            edit(self.review)
            self.bind()
            with self.assertRaises(ValueError):
                self.reviews()

    def test_camera_only_media_selection_does_not_claim_missing_photos_or_masks(self):
        self.review.update(photos=[], masks=[])
        self.proof['photoAvailability'] = 'not_found'
        self.bind()
        self.reviews()
        manifest = json.loads(manifest_assets(self.review, self.entry, hf_url)[self.review['selectionSha256'] + '.manifest.json'])
        self.assertTrue(manifest['skipImages'])
        self.assertNotIn('imageNameToPath', manifest)
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertNotIn('images', updated['availableData'])
        self.assertNotEqual(updated['photoAvailability'], 'complete_export_checked')

    def test_omitting_known_photos_cannot_keep_a_complete_photo_badge(self):
        self.review.update(photos=[], masks=[])
        self.bind()
        self.proof['photoAvailability'] = 'complete_export_checked'
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['photoAvailability'], 'path_policy_required')
        self.assertEqual(updated['availableData']['images']['status'], 'needs_setup')

    def test_manifest_selection_preserves_separately_checked_scene_components(self):
        self.review.update(photos=[], masks=[], points=None)
        self.review['counts']['points'] = 0
        self.bind()
        self.reviews()
        companions = {
            'point_cloud': {'status': 'checked', 'count': 17, 'samplePath': 'scene/input.ply'},
            'splats': {'status': 'checked', 'samplePath': 'scene/point_cloud/iteration_30000/point_cloud.ply'},
            'masks': {'status': 'listed', 'count': 4, 'samplePath': 'scene/masks/a.png'},
            'meshes': {'status': 'checked', 'samplePath': 'scene/mesh.ply'},
        }
        self.proof['availableData'].update(copy.deepcopy(companions))
        self.proof['photoAvailability'] = 'companion_archive'
        self.proof['availableData']['images'] = {'status': 'archive'}
        original = copy.deepcopy(self.proof)
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['sceneManifest']['counts']['points'], 0)
        self.assertEqual(updated['sceneManifest']['photoCount'], 0)
        self.assertEqual(updated['sceneManifest']['maskCount'], 0)
        self.assertEqual(updated['photoAvailability'], 'companion_archive')
        self.assertEqual(updated['availableData']['images'], {'status': 'archive'})
        for kind, evidence in companions.items():
            self.assertEqual(updated['availableData'][kind], evidence)
        self.assertEqual(self.proof, original)

    def test_native_points_and_partial_photos_keep_their_original_meaning(self):
        self.review['points'].update(sourcePath=self.files['points3d'], format='colmap_text')
        self.review['counts']['images'] = 2
        self.bind()
        self.reviews()
        self.proof['sceneCompatibility'].update(points=42, images=2)
        updated, _ = apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)
        self.assertEqual(updated['sceneManifest']['counts']['points'], 42)
        self.assertEqual(updated['photoAvailability'], 'partial')
        self.assertEqual(updated['photoAudit']['nameCheck']['missing'], 1)
        self.review['points']['sourcePath'] = 'peer/points3D.txt'
        with self.assertRaisesRegex(ValueError, 'preserve native points'):
            apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)

    def test_nonempty_native_cloud_or_different_companion_cannot_be_silently_replaced(self):
        for native_points in (1, None):
            proof = {**self.proof, 'sceneCompatibility': {**self.proof['sceneCompatibility'], 'points': native_points}}
            with self.assertRaisesRegex(ValueError, 'exact empty native'):
                apply_manifest_evidence(self.entry, self.row, 'a' * 40, proof, self.review, hf_url)
        self.review['points']['sourcePath'] = 'peer/points3D.ply'
        with self.assertRaisesRegex(ValueError, 'exact empty native'):
            apply_manifest_evidence(self.entry, self.row, 'a' * 40, self.proof, self.review, hf_url)

    def test_cross_scope_photo_association_needs_both_identical_camera_and_pose_files(self):
        self.review['associationFiles'] = copy.deepcopy(self.review['modelFiles'])
        self.bind()
        self.reviews()
        self.review['associationFiles']['images']['sha256'] = 'e' * 64
        self.bind()
        with self.assertRaisesRegex(ValueError, 'identical camera and pose'):
            self.reviews()


if __name__ == '__main__':
    unittest.main()
