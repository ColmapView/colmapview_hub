import unittest
from scripts.audit.audit_zero_point_scenes import audit, effective_counts, finding


class ZeroPointAuditTest(unittest.TestCase):
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
