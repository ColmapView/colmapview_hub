import copy
import hashlib
import json
import unittest

from scripts.catalog.build_individual_catalog import hf_url
from scripts.catalog.photo_routing import apply_routing, routing_asset, routing_coverage, routing_failures, routing_reviews, selection_digest


class PhotoRoutingTests(unittest.TestCase):
    def setUp(self):
        self.entry = {'sourceId': 'hf:owner/data', 'title': 'Data', 'provider': 'huggingface', 'access': 'public',
                      'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        self.files = {'cameras': 'scene/calibration/cameras.bin', 'images': 'scene/calibration/images.bin',
                      'points3d': 'scene/calibration/points3D.txt', 'asset:other.ply': 'scene/other.ply'}
        self.launch = 'https://colmapview.opsiclear.com/?url=' + hf_url(self.entry, 'a' * 40, 'scene/calibration')
        self.policy = {'schemaVersion': 1, 'checkedAt': '2026-10-19', 'viewerVersion': '0.17.7', 'viewerCommit': 'b' * 40}
        self.item = {'sourceId': self.entry['sourceId'], 'revision': 'a' * 40, 'kind': 'colmap', 'path': 'scene/calibration',
            'files': self.files, 'scope': 'scene/calibration', 'sourceViewerUrl': self.launch,
            'photos': ['scene/images/front/a.png', 'scene/images/front/b.png'], 'masks': ['scene/masks/front/a.png.png'],
            'nameToPath': {'front/a.png': 'scene/images/front/a.png'},
            'sample': {'path': 'scene/images/front/a.png', 'name': 'front/a.png', 'sha256': 'c' * 64, 'width': 80, 'height': 60},
            'nameCheck': {'inspected': 1, 'matched': 1, 'ambiguous': 0, 'registered': 4, 'complete': False},
            'modelReceipts': {role: {'path': self.files[role], 'bytes': 80, 'sourceBytes': 80 if role == 'cameras' else 2000,
                'sha256': 'd' * 64, 'entire': role == 'cameras'} for role in ('cameras', 'images')},
            'checks': {key: True for key in ('inventoryComplete', 'sampleDimensionsMatch', 'sampleBinding', 'manifestBinding', 'noSelectionPrompt')}}
        self.proof = {'level': 'native_layout_checked', 'viewerUrl': self.launch, 'photoAvailability': 'path_policy_required',
            'sceneCompatibility': {'cameras': 1, 'images': 4, 'points': 23},
            'photoAudit': {'samplePath': self.item['sample']['path'], 'sampleBrowserRead': True, 'status': 'path_policy_required',
                'proposedNameCheck': {'registered': 4, 'matched': 4}},
            'availableData': {'cameras': {'status': 'checked'}, 'point_cloud': {'status': 'checked', 'count': 23}, 'images': {'status': 'needs_setup'}},
            'thumbnail': {'sourceSha256': 'c' * 64, 'originalWidth': 80, 'originalHeight': 60}}

    def bind(self):
        self.item['selectionSha256'] = selection_digest({**self.item, **{key: self.policy[key] for key in ('checkedAt', 'viewerVersion', 'viewerCommit')}})

    def review(self):
        self.bind()
        reviews = routing_reviews({'entries': [self.entry]}, {**self.policy, 'scenes': [self.item]})
        return next(iter(reviews.values()))

    def apply(self):
        return apply_routing(self.entry, ['colmap', self.item['path'], self.files, None], 'a' * 40, self.proof, self.review(), hf_url)

    def test_sibling_manifest_keeps_exact_model_and_original_optional_asset_scope(self):
        review = self.review()
        name, body = routing_asset(review, self.entry, hf_url)
        manifest = json.loads(body)
        self.assertEqual(name, hashlib.sha256(body).hexdigest() + '.manifest.json')
        self.assertEqual(manifest['baseUrl'], hf_url(self.entry, 'a' * 40, 'scene/calibration') + '/')
        self.assertEqual(manifest['files']['points3D'], hf_url(self.entry, 'a' * 40, self.files['points3d']))
        self.assertEqual(manifest['imageNameToPath']['front/a.png'], hf_url(self.entry, 'a' * 40, self.item['photos'][0]))
        self.assertEqual(manifest['masks'], [hf_url(self.entry, 'a' * 40, self.item['masks'][0])])
        self.assertNotIn('splats', manifest)
        self.assertNotIn('viewerStatePath', manifest)
        self.assertNotIn('asset:other.ply', manifest['files'])

    def test_routing_preserves_statistics_and_export_tier(self):
        result = self.apply()
        self.assertEqual(result['sceneCompatibility'], self.proof['sceneCompatibility'])
        self.assertEqual(result['level'], 'native_layout_checked')
        self.assertNotIn('sceneManifest', result)
        self.assertNotIn('sceneValidation', result)
        self.assertEqual(result['availableData']['point_cloud'], self.proof['availableData']['point_cloud'])
        self.assertEqual(result['photoAvailability'], 'sample_checked')
        self.assertEqual(result['photoAudit']['nameCheck'], {'registered': 1, 'matched': 1, 'missing': 0, 'ambiguous': 0, 'scope': 'prefix', 'totalRegistered': 4})
        self.assertNotIn('proposedNameCheck', result['photoAudit'])
        self.assertEqual(self.proof['viewerUrl'], self.launch)
        self.assertEqual(self.proof['photoAvailability'], 'path_policy_required')

    def test_root_inventory_and_unicode_are_relative_to_pinned_repository(self):
        self.item['scope'] = ''
        self.item['photos'].append('scene/images/front/café.png')
        manifest = json.loads(routing_asset(self.review(), self.entry, hf_url)[1])
        self.assertEqual(manifest['images'], self.item['photos'])
        self.assertEqual(manifest['baseUrl'], hf_url(self.entry, 'a' * 40, '') + '/')

    def test_checked_original_photo_does_not_require_a_published_thumbnail(self):
        self.proof.pop('thumbnail')
        self.proof['photoAudit'].update(sampleSha256='c' * 64, sampleWidth=80, sampleHeight=60,
            samplePixels='decoded', sampleDimensionsMatch=True, sampleRegisteredName='front/a.png')
        self.assertNotIn('thumbnail', self.apply())
        original = copy.deepcopy(self.proof)
        for field, value in [('sampleSha256', 'e' * 64), ('sampleWidth', 160), ('samplePixels', 'deferred'),
                             ('sampleDimensionsMatch', False), ('sampleRegisteredName', 'different.png')]:
            self.proof = copy.deepcopy(original)
            self.proof['photoAudit'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'checked photograph bytes'):
                self.apply()

    def test_selection_edits_require_reaudit(self):
        self.bind()
        for key, value in [('photos', ['unreviewed/a.png']), ('scope', ''), ('sourceViewerUrl', 'different'), ('nameToPath', {'a.png': 'scene/images/front/b.png'})]:
            item = {**self.item, key: value}
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'selection-bound'):
                routing_reviews({'entries': [self.entry]}, {**self.policy, 'scenes': [item]})

    def test_unsafe_or_unproven_selections_fail_even_when_rebound(self):
        mutations = [lambda x: x.update(revision='e' * 40), lambda x: x['photos'].append('../other.png'),
            lambda x: x['photos'].append(x['photos'][0]), lambda x: x['masks'].append(x['photos'][0]),
            lambda x: x['photos'].append('._a.png'), lambda x: x['checks'].update(sampleBinding=False),
            lambda x: x['nameCheck'].update(complete=True), lambda x: x['nameCheck'].update(matched=2),
            lambda x: x['modelReceipts']['cameras'].update(entire=False),
            lambda x: x['modelReceipts']['images'].update(sourceBytes=79),
            lambda x: x['nameToPath'].update({'another.png': 'unlisted.png'})]
        original = copy.deepcopy(self.item)
        for mutation in mutations:
            self.item = copy.deepcopy(original)
            mutation(self.item)
            with self.subTest(item=self.item), self.assertRaises(ValueError):
                self.review()

    def test_existing_manifests_and_stronger_exports_cannot_be_replaced(self):
        for key in ('sceneManifest', 'sceneValidation'):
            self.proof[key] = {'status': 'passed'}
            with self.assertRaisesRegex(ValueError, 'full-export'):
                self.apply()
            del self.proof[key]
        self.item['sourceViewerUrl'] = 'https://colmapview.opsiclear.com/?url=https://colmapview.opsiclear.com/hub/datasets/individual/manifests/old.manifest.json'
        with self.assertRaisesRegex(ValueError, 'original launch'):
            self.review()

    def test_changed_model_launch_photo_bytes_or_dimensions_cannot_inherit_routing(self):
        original = copy.deepcopy(self.proof)
        for mutation in [lambda p: p.update(viewerUrl='other'), lambda p: p['thumbnail'].update(sourceSha256='e' * 64),
                         lambda p: p['thumbnail'].update(originalWidth=160), lambda p: p['sceneCompatibility'].update(images=5)]:
            self.proof = copy.deepcopy(original)
            mutation(self.proof)
            with self.assertRaises(ValueError):
                self.apply()

    def test_coverage_keeps_inventory_full_export_and_archives_distinct(self):
        self.assertEqual(routing_coverage(self.apply(), 'colmap')['launchRouting'], 'photo_inventory_manifest')
        self.assertEqual(routing_coverage({'sceneManifest': {}}, 'colmap')['launchRouting'], 'native_discovery_or_review')
        self.assertEqual(routing_coverage({'sceneManifest': {'url': 'full'}}, 'colmap')['launchRouting'], 'full_scene_manifest')
        self.assertEqual(routing_coverage({'photoAvailability': 'companion_archive'}, 'colmap')['launchRouting'], 'companion_archive')
        self.assertEqual(routing_coverage({'photoAvailability': 'not_included'}, 'colmap')['launchRouting'], 'no_photo_association')

    def test_unresolved_revision_is_checked(self):
        failure = {'sourceId': self.entry['sourceId'], 'revision': 'e' * 40, 'kind': 'colmap', 'path': self.item['path'], 'reason': 'Calibration differs'}
        with self.assertRaisesRegex(ValueError, 'exact pinned'):
            routing_failures({'entries': [self.entry]}, {'failures': [failure]})

    def test_source_mapping_retains_later_names_without_claiming_their_native_records_were_inspected(self):
        self.item['nameToPath']['later-renamed.jpg'] = self.item['photos'][1]
        with self.assertRaisesRegex(ValueError, 'authoritative'):
            self.review()
        self.item['mappingReceipts'] = [{'path': 'scene/image_mapping.csv', 'kind': 'image_mapping_csv', 'sha256': 'e' * 64,
            'url': hf_url(self.entry, 'a' * 40, 'scene/image_mapping.csv'), 'complete': True}]
        result = self.apply()
        self.assertEqual(result['photoRouting']['mappedNames'], 2)
        self.assertEqual(result['photoRouting']['nameCheck']['matched'], 1)
        manifest = json.loads(routing_asset(self.review(), self.entry, hf_url)[1])
        self.assertTrue(manifest['imageNameToPath']['later-renamed.jpg'].endswith('/scene/images/front/b.png'))

    def test_a_prefix_review_cannot_erase_a_previous_complete_name_check(self):
        self.proof['photoAudit']['nameCheck'] = {'registered': 4, 'matched': 4, 'missing': 0, 'ambiguous': 0}
        with self.assertRaisesRegex(ValueError, 'stronger registered-name'):
            self.apply()


if __name__ == '__main__':
    unittest.main()
