import copy
import gzip
import json
import unittest
from pathlib import Path
from urllib.parse import quote

from scripts.audit.plan_splat_links import media_scope, listed_geometry
from scripts.catalog.splat_routing import apply_splats, digest, splat_asset, splat_reviews


class SplatRoutingTests(unittest.TestCase):
    def setUp(self):
        self.revision = 'a' * 40
        self.entry = {'sourceId': 'hf:owner/data', 'facts': [{'label': 'Pinned revision', 'value': self.revision}]}
        self.files = {'cameras': 'scene/sparse/0/cameras.bin', 'images': 'scene/sparse/0/images.bin'}
        self.root = f'https://huggingface.co/datasets/owner/data/resolve/{self.revision}/'
        base = {'version': 1, 'baseUrl': self.root + 'scene/sparse/0',
                'files': {'cameras': 'cameras.bin', 'images': 'images.bin'},
                'imagesPath': self.root + 'scene/images/', 'splats': []}
        asset = {'path': 'scene/output.ply', 'url': self.root + 'scene/output.ply', 'format': 'ply', 'bytes': 3000,
                 'gaussians': 10, 'role': 'model', 'headerSha256': 'b' * 64, 'headerBytes': 100,
                 'allowOrigin': '*', 'headerCheckedAt': '2026-10-25', 'association': 'scene_hierarchy'}
        self.route = {'id': 'data-' + 'c' * 24, 'sourceId': self.entry['sourceId'], 'revision': self.revision,
                      'kind': 'cameras', 'path': 'scene/sparse/0', 'files': self.files,
                      'baseViewerUrl': 'https://colmapview.opsiclear.com/?url=' + quote(self.root + 'scene/sparse/0', safe=''),
                      'baseManifest': base, 'manifest': {**base, 'splats': [asset['url']]}, 'assets': [asset]}

    def validated(self, route=None):
        route = copy.deepcopy(route or self.route)
        route.pop('receiptSha256', None)
        route['receiptSha256'] = digest(route)
        return splat_reviews({'entries': [self.entry]}, {'schemaVersion': 1, 'checkedAt': '2026-10-25',
                             'viewerVersion': '0.25.0', 'viewerCommit': 'e' * 40, 'routes': [route]})[route['id']]

    def test_preserves_photos_sparse_evidence_and_warnings(self):
        review = self.validated()
        proof = {'viewerUrl': review['baseViewerUrl'], 'availableData': {'cameras': {'status': 'checked'}},
                 'sceneCompatibility': {'points': 0, 'images': 2}, 'sourceIntegrityReview': {'status': 'inconsistent'},
                 'photoAudit': {'samplePath': 'scene/images/a.jpg'}}
        result = apply_splats(self.entry, ('cameras', review['path'], self.files, None), self.revision, proof, review)
        for key in ('sceneCompatibility', 'sourceIntegrityReview', 'photoAudit'):
            self.assertEqual(result[key], proof[key])
        self.assertEqual(result['availableData']['splats']['count'], 1)
        self.assertNotIn('splats', proof['availableData'])
        manifest = json.loads(splat_asset(review)[1])
        self.assertEqual(manifest['imagesPath'], review['baseManifest']['imagesPath'])
        self.assertEqual(manifest['files'], review['baseManifest']['files'])

    def test_camera_metadata_uses_v2_without_turning_gaussians_into_points(self):
        route = copy.deepcopy(self.route)
        route['baseManifest'] = {'format': 'colmapview-camera-dataset', 'version': 1, 'metadataUrl': self.root + 'scene/transforms.json'}
        route['baseViewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + quote(route['baseManifest']['metadataUrl'], safe='')
        route['manifest'] = {**route['baseManifest'], 'version': 2, 'splats': [route['assets'][0]['url']]}
        review = self.validated(route)
        self.assertEqual(review['manifest']['version'], 2)
        self.assertNotIn('pointCloud', review['manifest'])

    def test_rejects_model_changes_even_with_a_new_operator_digest(self):
        for mutate in [lambda r: r['manifest']['files'].update(images='another.bin'),
                       lambda r: r['baseManifest']['files'].update(cameras='another.bin'),
                       lambda r: r['assets'][0].update(url=self.root.replace(self.revision, 'f' * 40) + 'scene/output.ply'),
                       lambda r: r['assets'][0].update(gaussians=0),
                       lambda r: r['assets'][0].update(path='../output.ply')]:
            route = copy.deepcopy(self.route)
            mutate(route)
            with self.assertRaises(ValueError):
                self.validated(route)

    def test_rejects_stale_photo_or_video_launch(self):
        review = self.validated()
        with self.assertRaises(ValueError):
            apply_splats(self.entry, ('cameras', review['path'], self.files, None), self.revision,
                         {'viewerUrl': 'https://colmapview.opsiclear.com/?url=new-photo-manifest'}, review)

    def test_shared_photographs_never_assign_geometry_to_another_variant(self):
        proof = {'photoAudit': {'sceneRoot': 'benchmark/clean/room'}}
        self.assertEqual(media_scope('colmap', 'benchmark/poisoned/room/sparse/0', proof), 'benchmark/poisoned/room')

    def test_colmap_only_inventories_include_embedded_gaussians_and_deduplicate_badges(self):
        rows = [['colmap', 'scene/sparse/0', {'cameras': 'scene/sparse/0/cameras.bin',
                 'asset:trained': 'scene/gs_scene/point_cloud.ply'}, None]]
        scenes = [{'archive': None, 'availableSplats': {'samplePath': 'scene/gs_scene/point_cloud.ply'}}]
        self.assertEqual(list(listed_geometry(rows, scenes)), [('ply', 'scene/gs_scene/point_cloud.ply', None, None)])

    def test_committed_audit_covers_every_current_audited_scene_and_keeps_gs_pool_times_separate(self):
        audit = json.loads(gzip.decompress(Path('data/gaussian-link-audit.json.gz').read_bytes()))
        policy = json.loads(gzip.decompress(Path('data/gaussian-routing.json.gz').read_bytes()))
        scenes = audit['scenes']
        self.assertEqual(len(scenes), audit['summary']['scenes'])
        self.assertEqual(len({scene['id'] for scene in scenes}), len(scenes))
        self.assertEqual({r['id'] for r in policy['routes']}, {s['id'] for s in scenes if s['status'] == 'ready'})
        self.assertTrue(all(scene['status'] in ('ready', 'already_linked_geometry')
                            for scene in scenes if scene.get('previousGaussianStatus') == 'checked'))
        for route in policy['routes']:
            if route['sourceId'] in ('hf:boazkg/gs-pool-paslcd', 'hf:boazkg/gs-pool-cl-splats'):
                capture = route['path'].removeprefix('inputs/').split('/sparse/')[0].split('/colmap/')[0]
                capture = '/'.join(capture.split('/')[:3])
                for asset in route['assets']:
                    self.assertTrue(asset['path'].startswith('members/' + capture + '/'), asset['path'])
                    for time in ('t1', 't2'):
                        if '/solve/' + time in route['path']:
                            self.assertTrue('/' + time + '/' in asset['path'] or asset['path'].endswith('/' + time.upper() + '_change.ply'))


if __name__ == '__main__':
    unittest.main()
