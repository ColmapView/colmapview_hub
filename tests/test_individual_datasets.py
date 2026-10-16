import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prepare_individual_datasets import individual_records, group_components
from build_individual_catalog import identity, item_evidence, tokens


class IndividualDatasetsTests(unittest.TestCase):
    def model(self, root):
        return [f'{root}/sparse/0/{name}.bin' for name in ('cameras', 'images', 'points3D')]

    def test_colmap_components_are_one_scene_and_gaussian_components_stay_with_it(self):
        paths = self.model('DTU/scan55') + ['DTU/scan55/inside_gaussians.ply', 'DTU/scan55/surface_gaussians.ply',
                                             'DTU/scan55/images/photo.jpg', 'DTU/scan55/masks/photo.png']
        rows = individual_records(paths)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:2], ['colmap', 'DTU/scan55/sparse/0'])
        self.assertEqual(len(rows[0][2]), 5)

    def test_unrelated_models_and_ambiguous_reconstructions_are_not_merged(self):
        paths = self.model('scene') + ['scene/another-object.ply', 'scene/another-object.glb']
        self.assertEqual(len(individual_records(paths)), 3)
        rows = [['colmap', 'scene/sparse/0', {'cameras': 'cameras.bin'}, None],
                ['colmap', 'scene/sparse/1', {'cameras': 'other.bin'}, None],
                ['ply', 'scene/point_cloud.ply', None, None]]
        self.assertEqual(len(group_components(rows)), 3)

    def test_paired_gaussian_components_without_colmap_are_one_scene(self):
        rows = individual_records(['scene/inside_gaussians.ply', 'scene/surface_gaussians.ply'])
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][:2], ['splat-scene', 'scene'])
        self.assertEqual(len(rows[0][2]), 2)

    def test_binary_and_text_copies_do_not_create_duplicate_models(self):
        rows = individual_records(self.model('scene') + [f'scene/sparse/0/{name}.txt' for name in ('cameras', 'images', 'points3D')])
        self.assertEqual(len(rows), 1)
        self.assertTrue(all(value.endswith('.bin') for value in rows[0][2].values()))

    def test_archive_members_and_camera_only_inputs_keep_distinct_identities(self):
        first = ['colmap', 'scene/sparse/0', {}, 'a.zip']
        second = ['colmap', 'scene/sparse/0', {}, 'b.zip']
        self.assertNotEqual(identity('hf:owner/data', first), identity('hf:owner/data', second))
        self.assertNotEqual(identity('hf:owner/data', first), identity('hf:other/data', first))
        self.assertEqual(identity('hf:owner/data', first), identity('hf:owner/data', [*first[:2], {'updated': 'metadata'}, first[3]]))
        rows = individual_records(['scene/cameras.bin', 'scene/images.bin', 'other/transforms.json'])
        self.assertEqual({row[0] for row in rows}, {'cameras', 'camera-metadata'})

    def test_a_successful_source_sample_never_qualifies_a_sibling_scene(self):
        entry = {'sourceId': 'hf:owner/data', 'status': 'audited_header_checked', 'statusLabel': 'Sample opened in viewer',
                 'viewerUrl': 'https://colmapview.opsiclear.com/?url=sample',
                 'verification': {'level': 'header_checked', 'delivery': 'browser_readable', 'summary': 'Sample opened'}}
        result = {'modelDirectory': 'first/sparse/0', 'revision': 'abc', 'loadUrl': 'https://huggingface.co/datasets/owner/data/tree/abc/first/sparse/0',
                  'browserChecks': [{'url': 'https://huggingface.co/datasets/owner/data/resolve/abc/first/sparse/0/cameras.bin', 'delivery': 'browser_readable'}]}
        self.assertIsNone(item_evidence(entry, ['colmap', 'second/sparse/0', {}, None], 'abc', result)[0])
        proof, _ = item_evidence(entry, ['colmap', 'first/sparse/0', {'cameras': 'first/sparse/0/cameras.bin'}, None], 'abc', result)
        self.assertEqual(proof['viewerUrl'], entry['viewerUrl'])

    def test_a_viewer_import_does_not_promote_other_header_samples_to_rendered(self):
        entry = {'sourceId': 'hf:owner/data', 'status': 'audited_header_checked', 'statusLabel': 'Sample opened in viewer',
                 'verification': {'level': 'header_checked', 'delivery': 'browser_readable', 'summary': 'Sample opened'}}
        result = {'viewerImport': {'sourceUrl': 'https://huggingface.co/datasets/owner/data/resolve/abc/first.ply'},
                  'probes': [{'url': 'https://huggingface.co/datasets/owner/data/resolve/abc/second.ply', 'format': 'gaussian_ply'}]}
        proof, format_name = item_evidence(entry, ['ply', 'second.ply', None, None], 'abc', result)
        self.assertEqual(proof['statusLabel'], 'Format headers checked')
        self.assertEqual(format_name, 'Gaussian PLY')
        self.assertNotIn('viewerUrl', proof)
        self.assertEqual(proof['delivery'], 'server_readable')

    def test_an_unsupported_codec_does_not_inherit_another_files_native_status(self):
        entry = {'sourceId': 'hf:owner/data', 'status': 'audited_header_checked', 'statusLabel': 'Format headers checked',
                 'verification': {'level': 'header_checked', 'delivery': 'browser_readable'}}
        result = {'loadUrl': 'https://huggingface.co/datasets/owner/data/resolve/abc/legacy.spz',
                  'probes': [{'url': 'https://huggingface.co/datasets/owner/data/resolve/abc/new.spz', 'format': 'spz_v4'}]}
        proof, _ = item_evidence(entry, ['spz', 'new.spz', None, None], 'abc', result)
        self.assertEqual(proof['level'], 'conversion_needed')
        self.assertEqual(proof['delivery'], 'server_readable')

    def test_archive_header_evidence_is_specific_to_the_model_inside_the_archive(self):
        entry = {'sourceId': 'hf:owner/data', 'status': 'audited_header_checked', 'statusLabel': 'Format headers checked', 'verification': {'level': 'header_checked'}}
        result = {'probes': [{'url': 'https://huggingface.co/datasets/owner/data/resolve/abc/a.zip', 'modelDirectory': 'first/sparse/0'}]}
        self.assertIsNone(item_evidence(entry, ['colmap', 'second/sparse/0', {}, 'a.zip'], 'abc', result)[0])

    def test_dataset_search_normalizes_accents_and_path_separators(self):
        self.assertEqual(tokens('NGS/DTU_scan55 Gaussian-PLY café'), {'ngs', 'dtu', 'scan55', 'gaussian', 'ply', 'cafe'})


if __name__ == '__main__':
    unittest.main()
