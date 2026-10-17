import gzip
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from prepare_individual_datasets import individual_records, group_components
from build_individual_catalog import build, can_open_scene, hf_url, identity, is_access_restricted, item_evidence, reviewed_scene_exclusions, tokens
from scene_qualification import REQUIRED_CHECKS, native_evidence, native_scene_reviews, qualified_evidence, verified_scene_reviews, verified_source_entry
from sampled_individuals import supplement_rows
from scene_datasets import MAX_SCENE_FILE_LINKS, scene_records


class IndividualDatasetsTests(unittest.TestCase):
    def test_scene_publication_matches_the_viewer_action_gates(self):
        cases = json.loads((Path(__file__).parent / 'fixtures/scene-publication.json').read_text(encoding='utf8'))
        verified = json.loads((Path(__file__).parent / 'fixtures/verified-scene-proof.json').read_text(encoding='utf8'))
        for case in cases:
            with self.subTest(case['name']):
                entry = {'provider': case.get('provider', 'huggingface'), 'access': case.get('access', 'public')}
                row = [case['kind'], 'scene', None, case.get('archive')]
                proof = {**(verified if case.get('verified') else {}), **case.get('proof', {})}
                if case.get('proof', {}).get('sceneValidation'):
                    proof['sceneValidation'] = {**verified['sceneValidation'], **case['proof']['sceneValidation']}
                self.assertEqual(can_open_scene(entry, row, proof), case['publish'])

    def verified_review(self, entry, row):
        revision = next(fact['value'] for fact in entry['facts'] if fact['label'] == 'Pinned revision')
        return {'sourceId': entry['sourceId'], 'revision': revision, 'kind': row[0], 'path': row[1],
                'files': row[2], 'loadPath': row[1], 'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + hf_url(entry, revision, row[1]),
                'checkedAt': '2026-10-17T14:24:25.257Z', 'viewerVersion': '0.17.0', 'viewerCommit': 'a' * 40,
                'counts': {'cameras': 1, 'images': 2, 'points': 3}, 'exportSha256': 'b' * 64,
                'checks': {key: 'passed' for key in REQUIRED_CHECKS},
                'photos': [{'name': f'{n}.png', 'sourcePath': f'images/{n}.png', 'bytes': 123, 'sha256': str(n) * 64} for n in range(2)]}

    def test_verified_scene_receipts_fail_closed_for_incomplete_or_stale_evidence(self):
        entry = {'sourceId': 'hf:owner/data', 'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        row = ['colmap', 'scene/sparse/0', {role: f'scene/sparse/0/{role}.bin' for role in ['cameras', 'images', 'points3d']}, None]
        review = self.verified_review(entry, row)
        policy = {'schemaVersion': 1, 'scenes': [review]}
        self.assertEqual(len(verified_scene_reviews({'entries': [entry]}, policy)), 1)
        for key in REQUIRED_CHECKS:
            with self.subTest(key=key):
                incomplete = json.loads(json.dumps(policy))
                incomplete['scenes'][0]['checks'][key] = 'not_tested'
                with self.assertRaisesRegex(ValueError, 'checks must pass'):
                    verified_scene_reviews({'entries': [entry]}, incomplete)
        for mutate in [lambda r: r.update(revision='b' * 40), lambda r: r['photos'].pop(),
                       lambda r: r['photos'][1].update(name='0.png'), lambda r: r['photos'][0].update(sha256='bad'),
                       lambda r: r['counts'].update(cameras=0), lambda r: r['counts'].update(images=True),
                       lambda r: r.update(exportSha256='bad')]:
            invalid = json.loads(json.dumps(policy))
            mutate(invalid['scenes'][0])
            with self.assertRaises(ValueError):
                verified_scene_reviews({'entries': [entry]}, invalid)
        policy['scenes'].append(review)
        with self.assertRaisesRegex(ValueError, 'Duplicate verified scene'):
            verified_scene_reviews({'entries': [entry]}, policy)

    def test_verified_scene_cannot_change_model_paths_or_launch_a_companion(self):
        entry = {'sourceId': 'hf:owner/data', 'provider': 'huggingface', 'sourceUrl': 'https://huggingface.co/datasets/owner/data',
                 'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}], 'viewerUrl': 'https://colmapview.opsiclear.com/?url=unqualified.ply'}
        row = ['colmap', 'scene/sparse/0', {role: f'scene/sparse/0/{role}.bin' for role in ['cameras', 'images', 'points3d']}, None]
        review = self.verified_review(entry, row)
        proof, format_name = qualified_evidence(entry, row, 'a' * 40, review, hf_url)
        self.assertEqual(proof['sceneValidation']['photoCount'], 2)
        collection = verified_source_entry(entry, [proof], [format_name])
        self.assertNotIn('viewerUrl', collection)
        self.assertEqual(collection['dataUrl'], entry['sourceUrl'])
        for mutation in [lambda r: r.update(loadPath='scene/points3d.ply'),
                         lambda r: r['files'].update(cameras='different/cameras.bin'),
                         lambda r: r.update(viewerUrl='https://colmapview.opsiclear.com/?url=unqualified.ply')]:
            invalid = json.loads(json.dumps(review))
            mutation(invalid)
            with self.assertRaises(ValueError):
                qualified_evidence(entry, row, 'a' * 40, invalid, hf_url)

    def test_native_layouts_qualify_without_photographs_and_keep_counts_unknown_for_text_headers(self):
        entry = {'sourceId': 'hf:owner/data', 'provider': 'huggingface', 'access': 'public',
                 'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}],
                 'verification': {'sourceImages': {'status': 'not_included', 'summary': 'Original RGB is not published.', 'sourceUrl': 'https://example.org/readme'}}}
        row = ['colmap', 'capture/sparse/0', {role: f'capture/sparse/0/{role}.txt' for role in ['cameras', 'images', 'points3d']}, None]
        policy = {'schemaVersion': 1, 'sources': [{'sourceId': entry['sourceId'], 'revision': 'a' * 40,
                  'models': [[row[1], row[2], None, None, None, 'not_checked', '2026-10-17',
                              {'cameraRecordChecked': True, 'poseRecordChecked': True}]]}]}
        review = next(iter(native_scene_reviews({'entries': [entry]}, policy).values()))
        proof, _ = native_evidence(entry, row, 'a' * 40, review, hf_url)
        self.assertTrue(can_open_scene(entry, row, proof))
        self.assertEqual(proof['photoAvailability'], 'not_included')
        self.assertIsNone(proof['sceneCompatibility']['images'])
        self.assertNotIn('sceneValidation', proof)
        for mutate in [lambda p: p['sources'][0].update(revision='b' * 40),
                       lambda p: p['sources'][0]['models'][0][7].update(poseRecordChecked=False),
                       lambda p: p['sources'][0]['models'][0].__setitem__(3, 0)]:
            invalid = json.loads(json.dumps(policy))
            mutate(invalid)
            with self.assertRaises(ValueError):
                native_scene_reviews({'entries': [entry]}, invalid)
        row[2]['cameras'] = 'other/cameras.txt'
        with self.assertRaisesRegex(ValueError, 'required file paths changed'):
            native_evidence(entry, row, 'a' * 40, review, hf_url)

    def test_verified_camera_json_scene_can_export_without_a_point_cloud(self):
        entry = {'sourceId': 'hf:owner/data', 'provider': 'huggingface',
                 'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}]}
        row = ['camera-scene', 'panorama', {'metadata:panorama/transforms.json': 'panorama/transforms.json',
                                        'asset:geometry': 'panorama/points3d.ply'}, None]
        review = self.verified_review(entry, row)
        review['files'] = {'metadata:panorama/transforms.json': 'panorama/transforms.json'}
        review['loadPath'] = 'panorama/transforms.json'
        review['viewerUrl'] = 'https://colmapview.opsiclear.com/?url=' + hf_url(entry, 'a' * 40, review['loadPath'])
        review['counts']['points'] = 0
        proof, _ = qualified_evidence(entry, row, 'a' * 40, review, hf_url)
        self.assertTrue(can_open_scene({'provider': 'huggingface', 'access': 'public'}, row, proof))
        review['loadPath'] = 'panorama/points3d.ply'
        with self.assertRaisesRegex(ValueError, 'checked camera metadata'):
            qualified_evidence(entry, row, 'a' * 40, review, hf_url)

    def test_reviewed_scene_exclusions_are_exact_and_require_the_pinned_revision(self):
        entry = {'sourceId': 'hf:owner/data', 'facts': [{'label': 'Pinned revision', 'value': 'abc'}]}
        review = {'sourceId': entry['sourceId'], 'revision': 'abc', 'reason': 'unsupported_camera_model',
                  'summary': 'Unsupported spherical camera.', 'scenes': [{'kind': 'colmap', 'path': 'bad/sparse/0'}]}
        policy = {'schemaVersion': 1, 'reviews': [review]}
        self.assertEqual(reviewed_scene_exclusions({'entries': [entry]}, policy),
                         {(entry['sourceId'], 'colmap', 'bad/sparse/0', None)})
        entry['facts'][0]['value'] = 'def'
        with self.assertRaisesRegex(ValueError, 'revision changed; recheck'):
            reviewed_scene_exclusions({'entries': [entry]}, policy)
        entry['facts'][0]['value'] = 'abc'
        policy['reviews'].append(review)
        with self.assertRaisesRegex(ValueError, 'Duplicate scene exclusion'):
            reviewed_scene_exclusions({'entries': [entry]}, policy)

    def test_publication_policy_matches_the_collection_build(self):
        cases = json.loads((Path(__file__).parent / 'fixtures/catalog-publication.json').read_text(encoding='utf8'))
        for case in cases:
            with self.subTest(case['name']):
                self.assertEqual(is_access_restricted(case['entry']), case['excluded'])

    def test_rebuild_removes_gated_source_assets_models_and_postings(self):
        temporary = Path(__file__).resolve().parents[1] / '.tmp'
        temporary.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='publication-test-', dir=temporary) as directory:
            root = Path(directory)
            data = root / 'data'
            (data / 'individual-datasets').mkdir(parents=True)
            entries, registered = [], []
            reviews = []
            for name in ['keep', 'gated', 'stale', 'mask-only']:
                entry = {'id': f'hf-{name}-0123456789ab', 'sourceId': f'hf:owner/{name}', 'title': name,
                         'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}], 'provider': 'huggingface',
                         'sourceUrl': f'https://huggingface.co/datasets/owner/{name}',
                         'access': 'public', 'license': 'cc0', 'status': 'audited_unverified', 'statusLabel': 'Further verification needed'}
                row = ['colmap', f'{name}/sparse/0', {role: f'{name}/sparse/0/{role}.bin' for role in ['cameras', 'images', 'points3d']}, None]
                reviews.append(self.verified_review(entry, row))
                listing = {'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'revision': 'a' * 40, 'listingComplete': True, 'items': [row]}
                raw = gzip.compress(json.dumps(listing).encode())
                file = entry['id'] + '.json.gz'
                (data / 'individual-datasets' / file).write_bytes(raw)
                entries.append(entry)
                registered.append({'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'count': 1,
                                   'file': file, 'sha256': hashlib.sha256(raw).hexdigest()})
            entries.append({'id': 'public-scene-0123456789ab', 'sourceId': 'public:scene', 'title': 'Public scene', 'provider': 'public',
                            'facts': [{'label': 'Collection', 'value': 'Scenes'}], 'access': 'public', 'license': 'cc0',
                            'formats': ['COLMAP'], 'statusLabel': 'Files listed', 'viewerUrl': 'https://colmapview.opsiclear.com/?url=sample'})
            entries[3]['checkedAt'] = '2026-10-17'
            entries[3]['verification'] = {'sourceImages': {'status': 'not_included',
                'summary': 'The publisher excludes original RGB images.', 'sourceUrl': 'https://example.org/readme'}}
            catalog = {'entries': entries}
            audit = {'results': []}
            def save(name, value):
                (data / name).write_text(json.dumps(value), encoding='utf8')
            save('catalog.json', catalog)
            save('individual-datasets.json', {'sources': registered, 'checkedAt': '2026-10-16', 'scope': 'Fixture'})
            save('dataset-audit.json', audit)
            save('scene-exclusions.json', {'schemaVersion': 1, 'reviews': []})
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps({'schemaVersion': 1, 'coverage': 'reviewed_scenes', 'sources': []}).encode()))
            save('verified-scenes.json', {'schemaVersion': 1, 'scenes': reviews})
            mask_review = reviews.pop()
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps({'schemaVersion': 1, 'coverage': 'reviewed_scenes', 'sources': []}).encode()))
            save('verified-scenes.json', {'schemaVersion': 1, 'scenes': reviews})
            native_policy = {'schemaVersion': 1, 'sources': [{'sourceId': entries[3]['sourceId'], 'revision': 'a' * 40,
                'models': [[mask_review['path'], mask_review['files'], 1, 2, 3, 'not_checked', '2026-10-17',
                            {'cameraRecordChecked': True, 'poseRecordChecked': True}]]}]}
            (data / 'native-layouts.json.gz').write_bytes(gzip.compress(json.dumps(native_policy).encode()))
            build(root)
            output = root / 'public/hub/datasets/individual'
            before = json.loads((output / 'index.json').read_text(encoding='utf8'))
            self.assertEqual(before['total'], 4)
            first_proof = json.loads((output / 'packs/0.json').read_text(encoding='utf8'))[0][7]
            self.assertEqual(first_proof['statusLabel'], 'Cameras + photos verified')
            mask_record = json.loads((output / 'packs/0.json').read_text(encoding='utf8'))[-1]
            self.assertEqual(mask_record[7]['photoAvailability'], 'not_included')
            photo_policy = {'schemaVersion': 1, 'coverage': 'all_published_scenes', 'sources': []}
            for model in [*reviews, mask_review]:
                photo_evidence = {'status': 'not_included' if model is mask_review else 'sample_checked', 'listingComplete': True,
                         'policy': 'fixture', 'summary': 'Pinned photo evidence.', 'checkedAt': '2026-10-17',
                         'samplePath': 'images/0.png', 'sampleBrowserRead': True, 'samplePixels': 'decoded'}
                photo_policy['sources'].append({'sourceId': model['sourceId'], 'revision': model['revision'],
                    'scenes': [{'kind': model['kind'], 'path': model['path'], 'files': model['files'], 'audit': photo_evidence}]})
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps(photo_policy).encode()))
            build(root)
            with_photos = json.loads((output / 'index.json').read_text(encoding='utf8'))
            self.assertNotEqual(before['generation'], with_photos['generation'])
            self.assertEqual(with_photos['photos'], {'complete_export_checked': 3, 'not_included': 1})
            self.assertEqual(sum(value['count'] for key, value in with_photos['facets']['photos'].items() if key != 'available'), 4)
            self.assertEqual(with_photos['facets']['photos']['available']['count'], 3)
            self.assertTrue((output / 'photo-audit.csv').exists())
            self.assertEqual(json.loads((output / 'photo-audit.json').read_text(encoding='utf8'))['scenes'], 4)
            photo_policy['sources'].pop()
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps(photo_policy).encode()))
            with self.assertRaisesRegex(ValueError, 'missing pinned photo evidence'):
                build(root)
            photo_policy['sources'].append({'sourceId': mask_review['sourceId'], 'revision': mask_review['revision'],
                'scenes': [{'kind': mask_review['kind'], 'path': mask_review['path'], 'files': mask_review['files'],
                            'audit': {'status': 'not_included', 'listingComplete': True, 'policy': 'fixture',
                                      'summary': 'Originals excluded.', 'checkedAt': '2026-10-17'}}]})
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps(photo_policy).encode()))
            build(root)
            self.assertTrue((output / 'sources' / (entries[3]['id'] + '.json')).exists())
            retained_id = identity(entries[0]['sourceId'], ['colmap', 'keep/sparse/0', None, None])
            removed_ids = [identity(entry['sourceId'], ['colmap', f'{entry["title"]}/sparse/0', None, None]) for entry in entries[1:3]]
            entries[1]['access'] = 'gated'
            audit['results'] = [{'sourceId': entries[2]['sourceId'], 'gated': 'manual'}]
            save('catalog.json', catalog)
            save('dataset-audit.json', audit)
            # Excluded payload listings need not be present or readable at build time.
            for source in registered[1:3]:
                (data / 'individual-datasets' / source['file']).unlink()
            build(root)
            after = json.loads((output / 'index.json').read_text(encoding='utf8'))
            self.assertNotEqual(before['generation'], after['generation'])
            self.assertEqual(after['total'], 2)
            self.assertEqual([source['id'] for source in after['sources']], [entries[0]['id'], entries[3]['id']])
            self.assertEqual(sum(facet['count'] for facet in after['facets']['status'].values()), 2)
            self.assertNotIn('Access required', after['facets']['status'])
            rows = json.loads((output / 'packs/0.json').read_text(encoding='utf8'))
            self.assertEqual(rows[0][0], retained_id)
            all_ids = {}
            for path in (output / 'ids').glob('*.json'):
                all_ids.update(json.loads(path.read_text(encoding='utf8')))
            self.assertIn(retained_id, all_ids)
            for item in removed_ids:
                self.assertNotIn(item, all_ids)
            for entry in entries[1:3]:
                self.assertFalse((output / 'sources' / (entry['id'] + '.json')).exists())
                token = entry['title']
                shard = hashlib.sha256(token.encode()).hexdigest()[:3]
                path = output / 'tokens' / (shard + '.json')
                self.assertTrue(not path.exists() or token not in json.loads(path.read_text(encoding='utf8')))

    def test_publication_removes_nonopening_scenes_and_cleans_excluded_assets(self):
        temporary = Path(__file__).resolve().parents[1] / '.tmp'
        temporary.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='scene-publication-', dir=temporary) as directory:
            root = Path(directory)
            data = root / 'data'
            (data / 'individual-datasets').mkdir(parents=True)
            entry = {'id': 'hf-owner-data-0123456789ab', 'sourceId': 'hf:owner/data', 'title': 'Scenes', 'provider': 'huggingface',
                     'access': 'public', 'license': 'cc0', 'status': 'audited_header_checked', 'statusLabel': 'Sample failed',
                     'sourceUrl': 'https://huggingface.co/datasets/owner/data',
                     'facts': [{'label': 'Pinned revision', 'value': 'a' * 40}], 'verification': {'level': 'header_checked'}}
            rows = [['colmap', f'{name}/sparse/0', {role: f'{name}/sparse/0/{role}.bin' for role in ['cameras', 'images', 'points3d']}, archive]
                    for name, archive in [('keep', None), ('failed', None), ('extract', 'bundle.zip')]]
            rows.append(['camera-metadata', 'source-only/transforms.json', None, None])
            listing = {'datasetId': entry['id'], 'sourceId': entry['sourceId'], 'revision': 'a' * 40, 'listingComplete': True, 'items': rows}
            raw = gzip.compress(json.dumps(listing).encode())
            filename = entry['id'] + '.json.gz'
            (data / 'individual-datasets' / filename).write_bytes(raw)
            def save(name, value):
                (data / name).write_text(json.dumps(value), encoding='utf8')
            save('catalog.json', {'entries': [entry]})
            save('individual-datasets.json', {'checkedAt': '2026-10-17', 'sources': [{'datasetId': entry['id'], 'sourceId': entry['sourceId'],
                 'count': len(rows), 'file': filename, 'sha256': hashlib.sha256(raw).hexdigest()}]})
            url = 'https://huggingface.co/datasets/owner/data/tree/abc/failed/sparse/0'
            save('dataset-audit.json', {'results': [{'sourceId': entry['sourceId'], 'modelDirectory': 'failed/sparse/0', 'revision': 'abc',
                 'loadUrl': url, 'viewerImport': {'sourceUrl': url, 'status': 'failed'}}]})
            policy = {'schemaVersion': 1, 'reviews': []}
            save('scene-exclusions.json', policy)
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps({'schemaVersion': 1, 'coverage': 'reviewed_scenes', 'sources': []}).encode()))
            save('verified-scenes.json', {'schemaVersion': 1, 'scenes': [self.verified_review(entry, rows[0])]})
            (data / 'native-layouts.json.gz').write_bytes(gzip.compress(json.dumps({'schemaVersion': 1, 'sources': []}).encode()))
            build(root)
            output = root / 'public/hub/datasets/individual'
            before = json.loads((output / 'index.json').read_text(encoding='utf8'))
            self.assertEqual(before['total'], 1)
            self.assertEqual(before['sources'][0]['count'], 1)
            record = json.loads((output / 'packs/0.json').read_text(encoding='utf8'))[0]
            self.assertEqual(record[3], 'keep/sparse/0', 'a failed sibling does not block a different native scene')
            policy['reviews'] = [{'sourceId': entry['sourceId'], 'revision': 'a' * 40, 'reason': 'model_files_unavailable',
                'summary': 'Original model URLs return 404.', 'scenes': [{'kind': 'colmap', 'path': 'keep/sparse/0'}]}]
            save('scene-exclusions.json', policy)
            build(root)
            after = json.loads((output / 'index.json').read_text(encoding='utf8'))
            self.assertNotEqual(before['generation'], after['generation'])
            self.assertEqual(after['total'], 0)
            self.assertEqual(after['sources'], [])
            for child in ['packs', 'ids', 'tokens', 'facets', 'sources']:
                self.assertEqual(list((output / child).glob('*.json')), [], child)
            save('scene-exclusions.json', {'schemaVersion': 1, 'reviews': []})
            moved = self.verified_review(entry, rows[0])
            moved['path'] = 'renamed/sparse/0'
            (data / 'scene-photos.json.gz').write_bytes(gzip.compress(json.dumps({'schemaVersion': 1, 'coverage': 'reviewed_scenes', 'sources': []}).encode()))
            save('verified-scenes.json', {'schemaVersion': 1, 'scenes': [moved]})
            with self.assertRaisesRegex(ValueError, 'no longer matches the scene listing'):
                build(root)

    def model(self, root):
        return [f'{root}/sparse/0/{name}.bin' for name in ('cameras', 'images', 'points3D')]

    def test_loose_model_files_cannot_establish_scene_datasets(self):
        rows = [[kind, f'data/Hourglass.{kind}', None, None] for kind in ['stl', 'ply', 'spz', 'sog', 'obj', 'glb']]
        self.assertEqual(scene_records(rows), [])

    def test_seed_and_triangulated_copies_are_one_scene_with_geometry_as_primary(self):
        rows = [['colmap', 'colmap/scene/' + variant,
                 {role: f'colmap/scene/{variant}/{role}.{suffix}' for role in ['cameras', 'images', 'points3d']}, None]
                for variant, suffix in [('known_pose_model', 'txt'), ('triangulated_text', 'txt'), ('triangulated_model', 'bin')]]
        original = json.dumps(rows)
        details = {}
        scene = scene_records(rows, details)
        self.assertEqual(len(scene), 1)
        self.assertEqual(scene[0][1], 'colmap/scene/triangulated_model')
        self.assertEqual(scene[0][2]['cameras'], 'colmap/scene/triangulated_model/cameras.bin')
        self.assertEqual(details[('colmap', scene[0][1], None)]['listedAssets'], 9)
        self.assertEqual(json.dumps(rows), original)

    def test_a_companion_import_is_evidence_without_a_camera_scene_viewer_launch(self):
        url = 'https://huggingface.co/datasets/owner/data/resolve/abc/scene/colmap.ply'
        entry = {'sourceId': 'hf:owner/data', 'access': 'public', 'status': 'audited_header_checked',
                 'statusLabel': 'Sample opened in viewer', 'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + url,
                 'verification': {'level': 'header_checked', 'delivery': 'browser_readable'}}
        result = {'loadUrl': url, 'probes': [{'url': url, 'format': 'point_cloud_ply'}],
                  'viewerImport': {'sourceUrl': url, 'status': 'passed'},
                  'browserChecks': [{'url': url, 'delivery': 'browser_readable'}]}
        scene = ['camera-scene', 'scene', {'metadata:cameras.npz': 'scene/cameras.npz', 'asset:ply': 'scene/colmap.ply'}, None]
        proof, _ = item_evidence(entry, scene, 'abc', result)
        self.assertNotIn('viewerUrl', proof)
        self.assertEqual(proof['sampleScope'], 'companion_asset')
        self.assertFalse(can_open_scene(entry, scene, proof))
        self.assertEqual(proof['statusLabel'], 'Companion asset opened; scene unverified')
        self.assertIn('Scene cameras', proof['summary'])
        self.assertIn('Only the linked companion', proof['scope'])
        self.assertIsNone(item_evidence(entry, ['camera-scene', 'other', {'asset:ply': 'other/colmap.ply'}, None], 'abc', result)[0])

    def test_explicit_coordinate_variant_review_keeps_one_scene_without_cross_container_merges(self):
        rows = [['colmap', root + '/triangulated_model', {'cameras': root + '/triangulated_model/cameras.bin'}, None]
                for root in ['colmap/scene', 'colmap_centered/scene']]
        rows += [['ply', 'colmap_centered/scene/point_cloud.ply', None, None]]
        scenes = scene_records(rows, root_aliases={'colmap_centered/scene': 'colmap/scene'})
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0][1], 'colmap/scene/triangulated_model')
        self.assertIn('colmap_centered/scene/point_cloud.ply', scenes[0][2].values())
        with self.assertRaises(ValueError):
            scene_records(rows, root_aliases={'colmap_centered/scene': 'unlisted/scene'})
        rows[1][3] = 'different.zip'
        with self.assertRaises(ValueError):
            scene_records(rows, root_aliases={'colmap_centered/scene': 'colmap/scene'})

    def test_camera_splits_and_companions_are_one_named_scene(self):
        rows = [['camera-metadata', f'bonsai/transforms_{split}.json', None, None] for split in ['train', 'val', 'test']]
        rows += [['ply', 'bonsai/point_cloud.ply', None, None], ['stl', 'unrelated/Hourglass.stl', None, None]]
        before = json.dumps(rows)
        details = {}
        scenes = scene_records(rows, details)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0][:2], ['camera-scene', 'bonsai'])
        self.assertEqual(set(scenes[0][2].values()), {row[1] for row in rows[:4]})
        self.assertEqual(details[('camera-scene', 'bonsai', None)]['listedAssets'], 4)
        self.assertEqual(json.dumps(rows), before)

    def test_reconstruction_variants_and_camera_metadata_stay_in_the_same_scene(self):
        rows = individual_records(self.model('bonsai') + ['bonsai/transforms_train.json', 'bonsai/transforms_test.json',
                                                       'bonsai/point_cloud/iteration_100/point_cloud.ply'])
        rows += [['colmap', 'bonsai/sparse/1', {'cameras': 'bonsai/sparse/1/cameras.bin'}, None]]
        scenes = scene_records(rows)
        self.assertEqual(len(scenes), 1)
        self.assertEqual(scenes[0][:2], ['colmap', 'bonsai/sparse/0'])
        self.assertIn('bonsai/transforms_train.json', scenes[0][2].values())
        self.assertIn('bonsai/sparse/1/cameras.bin', scenes[0][2].values())
        self.assertIn('bonsai/point_cloud/iteration_100/point_cloud.ply', scenes[0][2].values())

    def test_scene_assets_use_the_closest_folder_and_the_same_archive(self):
        rows = [['camera-metadata', 'scene/transforms.json', None, 'a.zip'],
                ['camera-metadata', 'scene/child/transforms.json', None, 'a.zip'],
                ['camera-metadata', 'scene/transforms.json', None, 'b.zip'],
                ['ply', 'scene/child/model.ply', None, 'a.zip']]
        scenes = scene_records(rows)
        by_root = {(row[3], row[1]): row for row in scenes}
        self.assertEqual(len(scenes), 3)
        self.assertIn('scene/child/model.ply', by_root[('a.zip', 'scene/child')][2].values())
        self.assertNotIn('scene/child/model.ply', by_root[('a.zip', 'scene')][2].values())
        self.assertNotIn('scene/child/model.ply', by_root[('b.zip', 'scene')][2].values())

    def test_asset_links_are_bounded_without_losing_inventory_counts_or_native_files(self):
        rows = individual_records(self.model('scene'))
        rows += [['ply', f'scene/checkpoint_{index}.ply', None, None] for index in range(100)]
        details = {}
        scene = scene_records(rows, details)[0]
        self.assertEqual(len(scene[2]), MAX_SCENE_FILE_LINKS)
        self.assertEqual(details[('colmap', 'scene/sparse/0', None)],
                         {'listedAssets': 103, 'linkedAssets': MAX_SCENE_FILE_LINKS, 'linksTruncated': True})
        self.assertEqual({role for role in scene[2] if not role.startswith('asset:')}, {'cameras', 'images', 'points3d'})

    def test_explicit_named_public_scenes_and_paired_gaussians_remain_scenes(self):
        rows = [['scene', 'Mip-NeRF 360 - bonsai', None, None],
                ['splat-scene', 'capture', {'asset:inside': 'capture/inside_gaussians.ply', 'asset:surface': 'capture/surface_gaussians.ply'}, None]]
        self.assertEqual({tuple(row[:2]) for row in scene_records(rows)}, {tuple(row[:2]) for row in rows})

    def test_split_metadata_in_separate_folders_belongs_to_one_scene(self):
        rows = [['camera-metadata', f'bonsai/{split}/transforms.json', None, None] for split in ['train', 'val', 'test']]
        scene = scene_records(rows)
        self.assertEqual(len(scene), 1)
        self.assertEqual(scene[0][:2], ['camera-scene', 'bonsai'])
        self.assertEqual(set(scene[0][2].values()), {row[1] for row in rows})

    def test_paired_gaussians_do_not_duplicate_a_scene_with_two_reconstructions(self):
        rows = individual_records(self.model('scan') + [f'scan/sparse/1/{name}.bin' for name in ['cameras', 'images', 'points3D']]
                                  + ['scan/inside_gaussians.ply', 'scan/surface_gaussians.ply'])
        scene = scene_records(rows)
        self.assertEqual(len(scene), 1)
        self.assertIn('asset:scan/inside_gaussians.ply', scene[0][2])
        self.assertIn('asset:scan/surface_gaussians.ply', scene[0][2])

    def test_root_reconstruction_does_not_claim_unrelated_object_files(self):
        rows = [['colmap', 'sparse/0', {'cameras': 'sparse/0/cameras.bin'}, None],
                ['stl', 'data/Hourglass.stl', None, None], ['ply', 'point_cloud/iteration_1/point_cloud.ply', None, None]]
        scene = scene_records(rows)[0]
        self.assertNotIn('data/Hourglass.stl', scene[2].values())
        self.assertIn('point_cloud/iteration_1/point_cloud.ply', scene[2].values())

    def test_exact_camera_metadata_conversion_evidence_survives_scene_grouping(self):
        url = 'https://huggingface.co/datasets/owner/data/resolve/abc/bonsai/transforms_train.json'
        entry = {'sourceId': 'hf:owner/data', 'access': 'public', 'status': 'audited_conversion_needed', 'statusLabel': 'Conversion needed',
                 'verification': {'level': 'conversion_needed', 'delivery': 'server_readable', 'summary': 'Needs conversion.'}}
        result = {'loadUrl': url, 'probes': [{'url': url, 'format': 'camera_metadata'}]}
        scene = ['camera-scene', 'bonsai', {'metadata:train': 'bonsai/transforms_train.json'}, None]
        proof, _ = item_evidence(entry, scene, 'abc', result)
        self.assertEqual(proof['level'], 'conversion_needed')
        self.assertIn('Only the linked camera metadata', proof['scope'])
        self.assertNotIn('viewerUrl', proof)

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

    def test_gated_exact_file_cannot_inherit_an_anonymous_viewer_link(self):
        url = 'https://huggingface.co/datasets/owner/data/resolve/abc/airplane.ply'
        entry = {'sourceId': 'hf:owner/data', 'access': 'gated', 'status': 'audited_header_checked', 'statusLabel': 'Format headers checked',
                 'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + url,
                 'verification': {'level': 'header_checked', 'delivery': 'browser_readable'}}
        result = {'loadUrl': url, 'probes': [{'url': url, 'format': 'point_cloud_ply'}],
                  'browserChecks': [{'url': url, 'delivery': 'browser_readable'}]}
        proof, _ = item_evidence(entry, ['ply', 'airplane.ply', None, None], 'abc', result)
        self.assertEqual(proof['statusLabel'], 'Access required')
        self.assertEqual(proof['delivery'], 'gated')
        self.assertNotIn('viewerUrl', proof)

    def test_archive_member_header_and_extracted_import_are_not_direct_archive_proof(self):
        url = 'https://huggingface.co/datasets/owner/data/resolve/abc/a.zip'
        entry = {'sourceId': 'hf:owner/data', 'access': 'public', 'status': 'audited_header_checked', 'statusLabel': 'Extract archive before loading',
                 'verification': {'level': 'header_checked', 'delivery': 'browser_readable', 'opening': {'status': 'extraction_required'}}}
        result = {'loadUrl': url, 'probes': [{'url': url, 'probes': [{'path': 'models/airplane.ply', 'format': 'point_cloud_ply'}]}],
                  'browserChecks': [{'url': url, 'delivery': 'browser_readable'}]}
        proof, format_name = item_evidence(entry, ['ply', 'models/airplane.ply', None, 'a.zip'], 'abc', result)
        self.assertEqual(format_name, 'XYZ point-cloud PLY')
        self.assertEqual(proof['opening']['status'], 'extraction_required')
        self.assertIn('Member headers', proof['statusLabel'])
        self.assertNotIn('viewerUrl', proof)
        self.assertIsNone(item_evidence(entry, ['ply', 'models/other.ply', None, 'a.zip'], 'abc', result)[0])
        result['extractedMemberImport'] = {'path': 'models/airplane.ply', 'sourceUrl': url, 'status': 'passed'}
        proof, _ = item_evidence(entry, ['ply', 'models/airplane.ply', None, 'a.zip'], 'abc', result)
        self.assertIn('Extracted file opened', proof['statusLabel'])
        self.assertIn('controlled same-origin', proof['summary'])
        self.assertNotIn('viewerUrl', proof)

    def test_exact_failed_file_and_sibling_header_retain_distinct_opening_requirements(self):
        first = 'https://huggingface.co/datasets/owner/data/resolve/abc/failed.ply'
        other = 'https://huggingface.co/datasets/owner/data/resolve/abc/other.ply'
        entry = {'sourceId': 'hf:owner/data', 'access': 'public', 'status': 'audited_header_checked', 'statusLabel': 'Sample failed to load',
                 'viewerUrl': 'https://colmapview.opsiclear.com/?url=' + first,
                 'verification': {'level': 'header_checked', 'opening': {'status': 'load_failed'}}}
        result = {'loadUrl': first, 'viewerImport': {'sourceUrl': first, 'status': 'failed'},
                  'probes': [{'url': first, 'format': 'point_cloud_ply'}, {'url': other, 'format': 'point_cloud_ply'}]}
        failed, _ = item_evidence(entry, ['ply', 'failed.ply', None, None], 'abc', result)
        sibling, _ = item_evidence(entry, ['ply', 'other.ply', None, None], 'abc', result)
        self.assertEqual(failed['opening']['status'], 'load_failed')
        self.assertNotIn('viewerUrl', failed)
        self.assertNotIn('opening', sibling)
        self.assertEqual(sibling['statusLabel'], 'Format headers checked')

    def test_positive_archive_header_additions_preserve_existing_ids_and_never_invent_siblings(self):
        result = {'sourceId': 'hf:owner/data', 'revision': 'abc', 'probes': [
            {'url': 'https://huggingface.co/datasets/owner/data/resolve/abc/folder/models.zip', 'completeDirectory': True,
             'probes': [{'path': 'models/airplane.ply', 'format': 'point_cloud_ply'}]}]}
        original = [['ply', 'existing.ply', None, None]]
        rows = supplement_rows(original, result, 'abc')
        self.assertEqual(rows, original + [['ply', 'models/airplane.ply', None, 'folder/models.zip']])
        self.assertEqual(identity('hf:owner/data', rows[0]), identity('hf:owner/data', original[0]))
        self.assertEqual(supplement_rows(rows, result, 'abc'), rows)
        self.assertEqual(supplement_rows(original, result, 'other'), original)
        result['probes'][0]['completeDirectory'] = False
        self.assertEqual(supplement_rows(original, result, 'abc'), original)

    def test_positive_archive_companion_is_not_split_from_an_existing_group(self):
        rows = [['colmap', 'scene/sparse/0', {'asset:scene/point_cloud.ply': 'scene/point_cloud.ply'}, 'models.zip']]
        result = {'sourceId': 'hf:owner/data', 'revision': 'abc', 'probes': [
            {'url': 'https://huggingface.co/datasets/owner/data/resolve/abc/models.zip', 'completeDirectory': True,
             'probes': [{'path': 'scene/point_cloud.ply', 'format': 'gaussian_ply'}]}]}
        self.assertEqual(supplement_rows(rows, result, 'abc'), rows)


if __name__ == '__main__':
    unittest.main()
