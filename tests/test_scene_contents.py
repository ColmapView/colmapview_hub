import copy
import hashlib
import io
import tarfile
import tempfile
import unittest
from pathlib import Path

from scripts.catalog.scene_contents import apply_content_evidence, apply_thumbnail_evidence, content_scene_reviews, is_metadata_sidecar
from scripts.audit.prepare_scene_contents import inspect_ply_header, ply_content, tar_photo, validate_asset_samples
from scripts.audit.prepare_scene_previews import archive_target, photo_url, preview_jobs


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

    def test_reused_preview_must_match_the_manifest_bound_photo_and_recorded_terms(self):
        proof = {'photoAvailability': 'complete_export_checked', 'photoAudit': {'samplePath': 'scene/images/a.png'}}
        entry = {'licenseCategory': 'commercial', 'license': 'cc-by-4.0'}
        thumbnail = {'file': 'a' * 64 + '.jpg', 'sourcePath': 'scene/images/a.png', 'datasetLicense': 'cc-by-4.0'}
        self.assertIn('thumbnail', apply_thumbnail_evidence(entry, proof, thumbnail))
        self.assertNotIn('thumbnail', proof)
        with self.assertRaisesRegex(ValueError, 'photograph does not match'):
            apply_thumbnail_evidence(entry, proof, {**thumbnail, 'sourcePath': 'peer/images/a.png'})
        for license in ('cc-by-nc-4.0', 'other', 'Not specified'):
            self.assertIn('thumbnail', apply_thumbnail_evidence({**entry, 'license': license, 'licenseCategory': 'not-specified'},
                          proof, {**thumbnail, 'datasetLicense': license}))
        with self.assertRaisesRegex(ValueError, 'license evidence'):
            apply_thumbnail_evidence({**entry, 'license': 'other'}, proof, thumbnail)

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

    def test_archived_components_remain_distinct_from_attached_scene_assets(self):
        evidence = {'status': 'header_checked', 'samplePath': '3dgs/scene.zip',
                    'archiveMember': 'scene/000001.ply', 'archiveFormat': 'zip'}
        self.review['data']['splats'] = evidence
        data = self.apply()['availableData']
        self.assertEqual(data['splats'], {**evidence, 'status': 'archive'})
        scene = {key: self.review[key] for key in ('kind', 'path', 'files', 'data')}
        policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'checkedAt': '2026-10-19',
                  'sources': [{'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'scenes': [scene]}]}
        content_scene_reviews({'entries': [self.entry]}, policy, Path('.'))
        evidence['status'] = 'listed'
        with self.assertRaisesRegex(ValueError, 'PLY extension'):
            content_scene_reviews({'entries': [self.entry]}, policy, Path('.'))
        evidence['status'] = 'header_checked'
        for member in ('../other.ply', '/other.ply', '__MACOSX/._a.ply'):
            evidence['archiveMember'] = member
            with self.subTest(member=member), self.assertRaisesRegex(ValueError, 'safe member'):
                content_scene_reviews({'entries': [self.entry]}, policy, Path('.'))

    def test_content_cannot_follow_a_changed_model_identity(self):
        self.row[2] = {**self.files, 'images': 'other/images.bin'}
        with self.assertRaisesRegex(ValueError, 'model files changed'):
            self.apply()

    def test_preview_requires_exact_photo_and_keeps_its_own_license(self):
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
            content_scene_reviews({'entries': [self.entry]}, policy, root)
            for license in ('cc-by-nc-4.0', 'other', 'Not specified'):
                self.entry['license'] = scene['thumbnail']['datasetLicense'] = license
                content_scene_reviews({'entries': [self.entry]}, policy, root)
            scene['thumbnail']['license'] = 'cc-by-sa-4.0'
            file.write_bytes(body + b'changed')
            with self.assertRaisesRegex(ValueError, 'bytes changed'):
                content_scene_reviews({'entries': [self.entry]}, policy, root)

    def test_bulk_preview_jobs_cover_checked_photos_without_changing_license_or_loading_evidence(self):
        scene = {key: copy.deepcopy(self.review[key]) for key in ('kind', 'path', 'files', 'data')}
        source = {'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'scenes': [scene]}
        contents = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'checkedAt': '2026-10-19', 'sources': [source]}
        audit = {'status': 'sample_checked', 'checkedAt': '2026-10-19', 'listingComplete': True, 'policy': 'exact_registered_sample',
                 'summary': 'Photo checked', 'samplePath': 'scene/images/a%20b.png', 'sampleBrowserRead': True, 'samplePixels': 'decoded'}
        photos = copy.deepcopy(contents)
        photos['sources'][0]['scenes'][0]['audit'] = audit
        for license in ('cc-by-4.0', 'cc-by-nc-4.0', 'other'):
            self.entry['license'] = license
            catalog = {'entries': [self.entry]}
            before = copy.deepcopy((catalog, contents, photos))
            jobs, retained, placeholders = preview_jobs(catalog, contents, photos, Path('.'))
            self.assertEqual((len(jobs), retained, placeholders), (1, 0, {}))
            self.assertEqual(jobs[0]['url'], 'https://huggingface.co/datasets/owner/data/resolve/' + 'a' * 40 + '/scene/images/a%2520b.png')
            self.assertEqual((catalog, contents, photos), before)
        audit['status'] = 'not_found'
        audit.pop('samplePath')
        jobs, retained, placeholders = preview_jobs(catalog, contents, photos, Path('.'))
        self.assertEqual((jobs, retained, placeholders), ([], 0, {'not_found': 1}))

    def test_public_preview_paths_use_the_exact_checked_https_photo(self):
        source = {'sourceId': 'public:example', 'revision': 'a' * 40}
        self.assertEqual(photo_url(source, 'https://example.org/photo.jpg'), 'https://example.org/photo.jpg')
        with self.assertRaisesRegex(ValueError, 'exact checked public source'):
            photo_url(source, 'http://example.org/photo.jpg')
        with self.assertRaisesRegex(ValueError, 'exact checked public source'):
            photo_url(source, 'relative/photo.jpg')

    def test_ply_headers_distinguish_splats_meshes_clouds_and_empty_geometry(self):
        header = b'ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n'
        self.assertEqual(ply_content(header + b'end_header\n'), 'point_cloud')
        self.assertEqual(ply_content(header + b'element face 1\nproperty list uchar int vertex_indices\nend_header\n'), 'meshes')
        gaussian = b''.join(b'property float ' + key.encode() + b'\n' for key in
                            ['f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'])
        self.assertEqual(ply_content(header + gaussian + b'end_header\n'), 'splats')
        self.assertIsNone(ply_content(header.replace(b'vertex 3', b'vertex 0') + b'end_header\n'))
        self.assertEqual(ply_content(header + b'element face 1\nproperty list uchar int vertex_indices\n' + gaussian + b'end_header\n'), 'meshes')

    def test_ply_whitespace_does_not_hide_valid_clouds_but_invalid_schema_is_rejected(self):
        header = b'ply\r\nformat binary_little_endian 1.0\r\nelement vertex 153653719   \r\nproperty float x \r\nproperty\tfloat\ty\r\nproperty float z\r\nend_header\r\n'
        self.assertEqual(ply_content(header), 'point_cloud')
        self.assertEqual(inspect_ply_header(header)['vertices'], 153653719)
        for invalid in (header.replace(b'1.0', b'2.0'), header.replace(b'format ', b'comment '),
                        header.replace(b'property float x ', b'property banana x'), header[:-4],
                        header.replace(b'property float z', b'property float x')):
            with self.subTest(header=invalid):
                self.assertIsNone(inspect_ply_header(invalid))
        no_xyz = header.replace(b'property float x ', b'property float other')
        self.assertIsNone(ply_content(no_xyz.replace(b'end_header', b'element face 1\nproperty list uchar int vertex_indices\nend_header')))

    def test_packed_gaussians_require_typed_vertex_fields_and_chunk_bounds(self):
        chunk = b'element chunk 2\n' + b''.join(b'property float ' + name.encode() + b'\n'
            for name in ('min_x', 'min_y', 'min_z', 'max_x', 'max_y', 'max_z',
                         'min_scale_x', 'min_scale_y', 'min_scale_z', 'max_scale_x', 'max_scale_y', 'max_scale_z'))
        vertices = b'element vertex 257\n' + b''.join(b'property uint ' + name.encode() + b'\n'
            for name in ('packed_position', 'packed_rotation', 'packed_scale', 'packed_color'))
        header = b'ply\nformat binary_little_endian 1.0\n' + chunk + vertices + b'end_header\n'
        self.assertEqual(inspect_ply_header(header), {'role': 'splats', 'vertices': 257,
                         'encoding': 'compressed_ply', 'format': 'binary_little_endian'})
        for invalid in (header.replace(b'chunk 2', b'chunk 1'), header.replace(b'uint packed_rotation', b'float packed_rotation'),
                        header.replace(b'min_scale_x', b'unknown'), header.replace(b'binary_little_endian', b'ascii'),
                        b'ply\nformat binary_little_endian 1.0\n' + vertices + b'end_header\n'):
            self.assertIsNone(ply_content(invalid))
        evidence = {'status': 'header_checked', 'samplePath': 'scene/gsplat/scene.ply',
                    'encoding': 'compressed_ply', 'requiresConversion': True}
        self.review['data']['splats'] = evidence
        self.assertEqual(self.apply()['availableData']['splats']['status'], 'needs_setup')
        scene = {key: self.review[key] for key in ('kind', 'path', 'files', 'data')}
        policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'checkedAt': '2026-10-19',
                  'sources': [{'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'scenes': [scene]}]}
        content_scene_reviews({'entries': [self.entry]}, policy, Path('.'))
        evidence['requiresConversion'] = False
        with self.assertRaisesRegex(ValueError, 'explicit conversion'):
            content_scene_reviews({'entries': [self.entry]}, policy, Path('.'))

    def test_tar_preview_checks_the_exact_regular_member_header_bounds_and_full_hash(self):
        body = b'checked photograph bytes'
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            info = tarfile.TarInfo('capture/photo.jpg')
            info.size = len(body)
            archive.addfile(info, io.BytesIO(body))
        payload = stream.getvalue()
        class Network:
            def get(self, url, start, length):
                return payload[start:start+length]
        sample = {'path': 'capture/photo.jpg', 'registeredName': 'photo.jpg', 'headerOffset': 0,
                  'dataOffset': 512, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
        job = {'url': 'https://example.org/images.tar', 'audit': {'archive': {'path': 'images.tar', 'format': 'tar',
               'bytes': len(payload), 'sample': sample}}}
        target = archive_target(Network(), job, {})
        self.assertEqual(tar_photo(Network(), target), body)
        for override in ({'sourcePath': 'other.jpg'}, {'sourceSha256': 'a' * 64}, {'dataOffset': 1024},
                         {'archiveBytes': 512}, {'sourcePath': '../photo.jpg'}, {'headerOffset': 1}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                tar_photo(Network(), {**target, **override})
        changed = bytearray(payload)
        changed[0] ^= 1
        payload = bytes(changed)
        with self.assertRaises(tarfile.ReadError):
            tar_photo(Network(), target)

    def test_tar_preview_supports_long_names_but_does_not_follow_symlinks(self):
        for format_name in (tarfile.GNU_FORMAT, tarfile.PAX_FORMAT):
            stream = io.BytesIO()
            name = 'capture/' + 'long-directory/' * 12 + 'photo.jpg'
            with tarfile.open(fileobj=stream, mode='w', format=format_name) as archive:
                info = tarfile.TarInfo(name)
                info.size = 3
                archive.addfile(info, io.BytesIO(b'RGB'))
            payload = stream.getvalue()
            with tarfile.open(fileobj=io.BytesIO(payload), mode='r:') as archive:
                member = archive.next()
            class Network:
                def get(self, url, start, length):
                    return payload[start:start+length]
            target = {'url': 'https://example.org/images.tar', 'archiveBytes': len(payload), 'sourcePath': name,
                      'headerOffset': member.offset, 'dataOffset': member.offset_data, 'bytes': 3,
                      'sourceSha256': hashlib.sha256(b'RGB').hexdigest()}
            self.assertEqual(tar_photo(Network(), target), b'RGB')
        stream = io.BytesIO()
        with tarfile.open(fileobj=stream, mode='w') as archive:
            info = tarfile.TarInfo('link.jpg')
            info.type, info.linkname = tarfile.SYMTYPE, 'outside.jpg'
            archive.addfile(info)
        payload = stream.getvalue()
        target.update(sourcePath='link.jpg', headerOffset=0, dataOffset=512, archiveBytes=len(payload))
        with self.assertRaisesRegex(ValueError, 'differs from reviewed'):
            tar_photo(Network(), target)


if __name__ == '__main__':
    unittest.main()
