import unittest
from scripts.audit.audit_zero_point_scenes import audit, effective_counts, finding, verified_frame_selection


class ZeroPointAuditTest(unittest.TestCase):
    def test_loaded_gaussians_keep_zero_sparse_points_and_need_independent_frame_world_evidence(self):
        index = {'generation': 'snapshot', 'total': 1, 'sources': [{'sourceId': 'hf:example/data'}]}
        files = {'cameras': 'cameras.bin', 'images': 'images.bin'}
        counts = {'cameras': 1, 'images': 2, 'points': 0}
        row = ['scene', 0, 'cameras', 'scene', 'COLMAP', None, files,
               {'sceneCompatibility': {'revision': 'a' * 40, **counts}}]
        prior = {'sources': [{'sourceId': 'hf:example/data', 'revision': 'a' * 40}],
                 'scenes': [{'id': 'scene', 'source': 0, 'kind': 'cameras', 'path': 'scene', 'files': files,
                             'scope': 'scene', 'scopeComplete': True, 'findings': {}}]}
        verified = {'id': 'scene', 'sourceId': 'hf:example/data', 'status': 'passed', 'counts': counts,
                    'sourceSha256': 'b' * 64, 'exportSha256': 'c' * 64,
                    'selectedGeometry': {'role': 'splat', 'count': 123, 'frame': '0000001', 'frameCount': 100},
                    **{key: 'passed' for key in ('pointValues', 'splatValues', 'splatWorldTransform', 'frameMembership', 'frameCameraNames')}}
        result = audit(index, [row], prior, exports=[verified])
        self.assertEqual(result['summary']['findings'], {'gaussian_frame_loaded': 1})
        self.assertEqual(result['summary']['recoveredPoints'], 0)
        for key in ('splatValues', 'splatWorldTransform', 'frameMembership', 'frameCameraNames'):
            with self.assertRaisesRegex(ValueError, 'independent'):
                audit(index, [row], prior, exports=[{**verified, key: 'not_checked'}])

    def test_temporal_camera_subsets_require_independent_original_frame_evidence(self):
        original={'cameras':92,'images':92,'points':0}
        exported={'cameraSourceFramesChecked':'passed','counts':{'cameras':4,'images':4,'points':2148},
                  'frameSelection':{'sourceCounts':original,'indices':[0,23,46,69]}}
        self.assertTrue(verified_frame_selection(exported,original))
        for indices in ([0,23,46,92],[0,23,46,46],[],['0',23,46,69]):
            self.assertFalse(verified_frame_selection({**exported,'frameSelection':{'sourceCounts':original,'indices':indices}},original))
        self.assertFalse(verified_frame_selection({**exported,'cameraSourceFramesChecked':'not_checked'},original))

    def test_auxiliary_confirmation_is_reused_only_for_the_exact_evidence_key(self):
        index={'generation':'snapshot','total':1,'sources':[{'sourceId':'hf:example/data'}]}
        files={'metadata:scene/cameras.npz':'scene/cameras.npz'}
        row=['scene',0,'camera-scene','scene','metadata',None,files,{'sceneValidation':{'revision':'a'*40,'cameras':1,'images':2,'points':0}}]
        prior={'sources':[{'sourceId':'hf:example/data','revision':'a'*40}],
               'scenes':[{'id':'scene','source':0,'kind':'camera-scene','path':'scene','files':files,'scope':'scene','scopeComplete':True,'findings':{'point_cloud':'container_review'}}]}
        key=audit(index,[row],prior)['scenes'][0]['evidenceKey']
        confirmed={'id':'scene','sourceId':'hf:example/data','revision':'a'*40,'evidenceKey':key,'status':'passed',
                   'conclusion':'camera_or_2d_flow_only','containers':1,'inspectionSha256':'b'*64}
        result=audit(index,[row],prior,confirmations=[confirmed])
        self.assertEqual(result['scenes'][0]['finding'],'no_points_in_auxiliary_containers')
        with self.assertRaisesRegex(ValueError,'confirmation differs'):
            audit(index,[row],prior,confirmations=[{**confirmed,'evidenceKey':'wrong'}])
    def test_changed_revision_or_unverified_replacement_cannot_reuse_a_confirmed_finding(self):
        index = {'generation': 'snapshot', 'total': 1, 'sources': [{'sourceId': 'hf:example/data'}]}
        files = {'cameras': 'cameras.bin', 'images': 'images.bin'}
        proof = {'sceneCompatibility': {'revision': 'a' * 40, 'cameras': 1, 'images': 2, 'points': 0}}
        row = ['scene', 0, 'cameras', 'scene', 'COLMAP', None, files, proof]
        prior = {'sources': [{'sourceId': 'hf:example/data', 'revision': 'a' * 40}],
                 'scenes': [{'id': 'scene', 'source': 0, 'kind': 'cameras', 'path': 'scene', 'files': files,
                             'scope': 'scene', 'scopeComplete': True, 'findings': {'point_cloud': 'not_listed_in_checked_scope'}}]}
        self.assertEqual(audit(index, [row], prior)['summary']['findings'], {'no_points_in_checked_scope': 1})
        with self.assertRaisesRegex(ValueError, 'complete'):
            audit(index, [], prior)
        with self.assertRaisesRegex(ValueError, 'independent'):
            audit(index, [row], prior, [{'id': 'scene', 'status': 'passed', 'pointValues': 'failed'}])
        proof['sceneCompatibility']['revision'] = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'selection changed'):
            audit(index, [row], prior)

    def test_selected_manifest_overrides_empty_native_count(self):
        self.assertEqual(effective_counts({'sceneCompatibility': {'points': 0},
                         'sceneManifest': {'counts': {'points': 350710}}})['points'], 350710)
        self.assertIsNone(effective_counts({'sceneCompatibility': {'points': None}})['points'])

    def test_geometry_inventory_is_separate_from_selected_model(self):
        prior = {'scopeComplete': True, 'findings': {'point_cloud': 'not_listed_in_checked_scope'}}
        self.assertEqual(finding('source', {'availableData': {'point_cloud': {'status': 'checked'}}}, prior), 'static_cloud_requires_binding')
        self.assertEqual(finding('source', {'availableData': {'point_cloud': {'status': 'archive'}}}, prior), 'animated_geometry_archive')
        self.assertEqual(finding('source', {'availableData': {'meshes': {'status': 'checked'}}}, prior), 'mesh_only')
        self.assertEqual(finding('source', {}, prior), 'no_points_in_checked_scope')
        self.assertEqual(finding('source', {}, {**prior, 'scopeComplete': False}), 'unresolved_geometry_association')
        self.assertEqual(finding('source', {}, {**prior, 'findings': {'point_cloud': 'container_review'}}), 'auxiliary_container_review')


if __name__ == '__main__':
    unittest.main()
