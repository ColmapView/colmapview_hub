import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.audit.prepare_individual_datasets import refresh_model_listing, write_pack


class ModelListingTests(unittest.TestCase):
    revision = 'a' * 40
    base = 'https://huggingface.co/api/datasets/owner/repo/tree/' + revision

    def test_complete_directory_walk_follows_encoded_repository_pagination_and_omits_media(self):
        base = self.base
        leaf = 'segments/haya_itokawa/20050909_20051119'
        pages = {
            '': ([{'type': 'directory', 'path': path} for path in ('segments', 'images', 'depth_maps')], {}),
            'segments': ([{'type': 'directory', 'path': 'segments/haya_itokawa'}], {}),
            'segments/haya_itokawa': ([{'type': 'directory', 'path': leaf}], {}),
            leaf: ([{'type': 'file', 'path': leaf + '/' + name, 'size': 64} for name in ('cameras.bin', 'images.bin')],
                   {'link': '<' + base.replace('owner/repo', 'owner%2Frepo') + '/' + leaf + '?cursor=second>; rel="next"'}),
            leaf + '?cursor=second': ([{'type': 'file', 'path': leaf + '/points3D.bin', 'size': 123}], {}),
        }
        calls = []

        class Network:
            def fetch(self, url, **kwargs):
                calls.append(url)
                self_path = url.removeprefix(base).lstrip('/')
                if '?recursive=' in self_path:
                    self_path = self_path.split('?')[0]
                page, headers = pages[self_path]
                return json.dumps(page).encode(), headers, 200, False

        with tempfile.TemporaryDirectory() as directory:
            result = refresh_model_listing('owner/repo', self.revision, Network(), Path(directory))
        self.assertTrue(result['listingComplete'])
        self.assertEqual(result['paths'], [leaf + '/' + name for name in ('cameras.bin', 'images.bin', 'points3D.bin')])
        self.assertEqual(result['visitedDirectories'], 4)
        self.assertEqual(result['omittedMediaPaths'], ['depth_maps', 'images'])
        self.assertEqual(len(calls), 5)
        self.assertTrue(all(call.startswith(base) for call in calls))
        self.assertEqual(result['files'][leaf + '/points3D.bin']['size'], 123)
        self.assertEqual(len(next(item for item in result['directories'] if item['path'] == leaf)['pages']), 2)

    def test_pagination_cannot_change_hosts_directories_revisions_or_repeat_cursors(self):
        for next_url in [self.base.replace('huggingface.co', 'example.com'), self.base + '/other',
                         self.base.replace(self.revision, 'b' * 40), self.base + '?limit=1000&expand=false&recursive=false']:
            with self.subTest(next_url=next_url), tempfile.TemporaryDirectory() as directory:
                class Network:
                    def fetch(self, url, **kwargs):
                        return b'[]', {'link': '<' + next_url + '>; rel="next"'}, 200, False

                with self.assertRaises(ValueError):
                    refresh_model_listing('owner/repo', self.revision, Network(), Path(directory))
                self.assertEqual(list(Path(directory).glob('*.json.gz')), [])

    def test_old_capped_cache_cannot_claim_complete_discovery(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            filename = hashlib.sha256(('owner/repo@' + self.revision).encode()).hexdigest() + '.json.gz'
            write_pack(cache / filename, {'paths': ['old/cameras.bin'], 'listingComplete': True})

            class Network:
                def fetch(self, url, **kwargs):
                    return b'[]', {}, 200, False

            result = refresh_model_listing('owner/repo', self.revision, Network(), cache)
        self.assertEqual(result['paths'], [])
        self.assertEqual(result['modelWalkVersion'], 2)

    def test_directory_response_cannot_escape_its_parent(self):
        class Network:
            def fetch(self, url, **kwargs):
                return b'[{"type":"directory","path":"../other"}]', {}, 200, False

        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'escaped'):
                refresh_model_listing('owner/repo', self.revision, Network(), Path(directory))


if __name__ == '__main__':
    unittest.main()
