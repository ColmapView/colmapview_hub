import copy
import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.catalog.scene_contents import apply_content_evidence, apply_thumbnail_evidence, content_scene_reviews, is_metadata_sidecar
from scripts.audit.prepare_scene_contents import ply_content, validate_asset_samples


class SceneContentsTests(unittest.TestCase):
    def test_metadata_sidecars_cannot_be_mask_samples_or_reused_preparation_inputs(self):
        for path in ('scene/mask/._000.png', '__MACOSX/scene/mask/000.png', 'scene/.DS_Store'):
            with self.subTest(path=path):
                self.assertTrue(is_metadata_sidecar(path))
                with self.assertRaisesRegex(ValueError, 'sidecars are not dataset assets'):
                    validate_asset_samples({'data': {'masks': {'status': 'listed', 'count': 2, 'samplePath': path}}})
                scene = {'kind': 'colmap', 'path': self.row[1], 'files': self.files,
                         'data': {'masks': {'status': 'listed', 'count': 2, 'samplePath': path}}}
                policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'checkedAt': '2026-10-18',
                          'sources': [{'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'scenes': [scene]}]}
                with self.assertRaisesRegex(ValueError, 'Invalid content role evidence'):
                    content_scene_reviews({'entries': [self.entry]}, policy, Path('.'))
        self.assertFalse(is_metadata_sidecar('scene/mask/_000.png'))
        validate_asset_samples({'data': {'masks': {'status': 'listed', 'count': 1, 'samplePath': 'scene/mask/000.png'}}})

    def test_reused_preview_must_match_the_manifest_bound_photo_and_commercial_terms(self):
        proof = {'photoAvailability': 'complete_export_checked', 'photoAudit': {'samplePath': 'scene/images/a.png'}}
        entry = {'licenseCategory': 'commercial', 'license': 'cc-by-4.0'}
        thumbnail = {'file': 'a' * 64 + '.jpg', 'sourcePath': 'scene/images/a.png', 'datasetLicense': 'cc-by-4.0'}
        self.assertIn('thumbnail', apply_thumbnail_evidence(entry, proof, thumbnail))
        self.assertNotIn('thumbnail', proof)
        with self.assertRaisesRegex(ValueError, 'photograph does not match'):
            apply_thumbnail_evidence(entry, proof, {**thumbnail, 'sourcePath': 'peer/images/a.png'})
        with self.assertRaisesRegex(ValueError, 'license evidence'):
            apply_thumbnail_evidence({**entry, 'licenseCategory': 'unknown'}, proof, thumbnail)

    def setUp(self):
        self.entry = {'sourceId': 'hf:owner/data', 'license': 'cc-by-4.0', 'licenseCategory': 'commercial',
                      'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        self.files = {'cameras': 'scene/sparse/0/cameras.bin', 'images': 'scene/sparse/0/images.bin', 'points3d': 'scene/sparse/0/points3D.bin'}
        self.row = ['colmap', 'scene/sparse/0', self.files, None]
        self.proof = {'level': 'native_layout_checked', 'viewerUrl': 'model-url', 'photoAvailability': 'not_included',
                      'sceneCompatibility': {'cameras': 1, 'images': 3, 'points': 0}}
        self.review = {'kind': self.row[0], 'path': self.row[1], 'files': self.files, 'revision': 'a' * 40, 'data': {}}

    def apply(self, proof=None):
        return apply_content_evidence(self.entry, self.row, 'a' * 40, proof or self.proof, self.review)

    def test_pose_files_and_empty_point_sets_are_not_photographs_or_clouds(self):
        updated = self.apply()
        self.assertEqual(updated['availableData'], {'cameras': {'status': 'checked', 'count': 1}})
        self.assertNotIn('availableData', self.proof)
        self.assertEqual(updated['viewerUrl'], self.proof['viewerUrl'])

    def test_positive_cloud_counts_and_photograph_loading_requirements_are_independent(self):
        for state, expected in [('sample_checked', 'checked'), ('path_policy_required', 'needs_setup'),
                                ('companion_archive', 'archive'), ('partial', 'partial')]:
            with self.subTest(state):
                proof = copy.deepcopy(self.proof)
                proof['sceneCompatibility']['points'] = 42
                proof['photoAvailability'] = state
                data = self.apply(proof)['availableData']
                self.assertEqual(data['point_cloud']['count'], 42)
                self.assertEqual(data['images']['status'], expected)

    def test_masks_do_not_restore_a_publisher_excluded_photo(self):
        self.review['data']['masks'] = {'status': 'listed', 'count': 3, 'samplePath': 'scene/gt_mask/0001.png'}
        data = self.apply()['availableData']
        self.assertIn('masks', data)
        self.assertNotIn('images', data)

    def test_content_cannot_follow_a_changed_model_identity(self):
        self.row[2] = {**self.files, 'images': 'other/images.bin'}
        with self.assertRaisesRegex(ValueError, 'model files changed'):
            self.apply()

    def test_preview_requires_exact_photo_and_can_keep_its_own_commercial_license(self):
        self.proof.update({'photoAvailability': 'sample_checked', 'photoAudit': {'samplePath': 'scene/images/a.jpg'}})
        self.review['thumbnail'] = {'file': 'a' * 64 + '.jpg', 'sourcePath': 'scene/images/a.jpg', 'license': 'cc-by-sa-4.0',
                                    'datasetLicense': 'cc-by-4.0', 'attribution': 'Photographer'}
        self.assertEqual(self.apply()['thumbnail']['license'], 'cc-by-sa-4.0')
        self.review['thumbnail']['sourcePath'] = 'other/images/a.jpg'
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.apply()

    def test_content_policy_rejects_stale_pins_unknown_ply_roles_and_changed_preview_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            scene = {key: self.review[key] for key in ('kind', 'path', 'files', 'data')}
            policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'checkedAt': '2026-10-17',
                      'sources': [{'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'scenes': [scene]}]}
            self.assertEqual(len(content_scene_reviews({'entries': [self.entry]}, policy, root)), 1)
            policy['sources'][0]['revision'] = 'b' * 40
            with self.assertRaisesRegex(ValueError, 'revision changed'):
                content_scene_reviews({'entries': [self.entry]}, policy, root)
            policy['sources'][0]['revision'] = 'a' * 40
            scene['data']['splats'] = {'status': 'listed', 'samplePath': 'scene/model.ply'}
            with self.assertRaisesRegex(ValueError, 'PLY extension'):
                content_scene_reviews({'entries': [self.entry]}, policy, root)
            scene['data'].clear()
            body = b'\xff\xd8\xff' + b'preview'
            digest = hashlib.sha256(body).hexdigest()
            preview_dir = root / 'data/scene-thumbnails'
            preview_dir.mkdir(parents=True)
            file = preview_dir / (digest + '.jpg')
            file.write_bytes(body)
            scene['thumbnail'] = {'file': file.name, 'width': 320, 'height': 320, 'crop': 'center_square',
                'sourcePath': 'scene/images/a.jpg', 'sourceSha256': 'a' * 64, 'license': 'cc-by-sa-4.0',
                'datasetLicense': self.entry['license'], 'attribution': 'Photographer'}
            content_scene_reviews({'entries': [self.entry]}, policy, root)
            scene['thumbnail']['license'] = 'cc-by-nc-4.0'
            with self.assertRaisesRegex(ValueError, 'commercial-license'):
                content_scene_reviews({'entries': [self.entry]}, policy, root)
            scene['thumbnail']['license'] = 'cc-by-sa-4.0'
            file.write_bytes(body + b'changed')
            with self.assertRaisesRegex(ValueError, 'bytes changed'):
                content_scene_reviews({'entries': [self.entry]}, policy, root)

    def test_ply_headers_distinguish_splats_meshes_clouds_and_empty_geometry(self):
        header = b'ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n'
        self.assertEqual(ply_content(header + b'end_header\n'), 'point_cloud')
        self.assertEqual(ply_content(header + b'element face 1\nproperty list uchar int vertex_indices\nend_header\n'), 'meshes')
        gaussian = b''.join(b'property float ' + key.encode() + b'\n' for key in
                            ['f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'])
        self.assertEqual(ply_content(header + gaussian + b'end_header\n'), 'splats')
        self.assertIsNone(ply_content(header.replace(b'vertex 3', b'vertex 0') + b'end_header\n'))
        self.assertEqual(ply_content(header + b'element face 1\n' + gaussian + b'end_header\n'), 'meshes')


if __name__ == '__main__':
    unittest.main()
