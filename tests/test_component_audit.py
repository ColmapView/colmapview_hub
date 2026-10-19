import unittest

from scripts.catalog.component_audit import missing_component_findings


class ComponentAuditTests(unittest.TestCase):
    def findings(self, missing=('images',), available=(), **options):
        return missing_component_findings(missing, available, source_readable=options.pop('source_readable', True),
                                          scope_complete=options.pop('scope_complete', True), **options)

    def test_missing_first_photo_or_an_archive_cannot_be_reported_as_absence(self):
        self.assertEqual(self.findings(photo_candidates=True)['images'], 'photo_association_review')
        self.assertEqual(self.findings(uninspected_containers=True)['images'], 'container_review')
        self.assertEqual(self.findings(association_candidates=True)['images'], 'scene_association_review')

    def test_only_a_complete_readable_scope_can_establish_non_listing(self):
        self.assertEqual(self.findings(scope_complete=False)['images'], 'inventory_incomplete')
        self.assertEqual(self.findings(source_readable=False)['images'], 'source_inaccessible')
        self.assertEqual(self.findings()['images'], 'not_listed_in_checked_scope')

    def test_unknown_ply_headers_and_cross_scene_candidates_remain_unresolved(self):
        self.assertEqual(self.findings(('splats',), unclassified_assets=True)['splats'], 'asset_header_review')
        self.assertEqual(self.findings(('meshes',), association_candidates=True)['meshes'], 'scene_association_review')

    def test_concrete_geometry_is_not_a_missing_generic_geometry_type(self):
        findings = self.findings(('point_cloud', 'splats', 'geometry'), ('point_cloud',))
        self.assertEqual(findings['point_cloud'], 'recovered')
        self.assertEqual(findings['geometry'], 'specific_geometry_already_present')
        self.assertEqual(findings['splats'], 'not_listed_in_checked_scope')

    def test_unknown_component_names_are_rejected(self):
        with self.assertRaises(ValueError):
            self.findings(('depth',))
