"""Classifier regression checks use in-memory bytes, never public dataset downloads."""

import io
import json
import struct
import tempfile
import time
import unittest
import zipfile
from pathlib import Path

from scripts.audit import dataset_audit as audit


class MemoryNetwork:
    def __init__(self, data, wrong_range=False):
        self.data, self.wrong_range = data, wrong_range

    def fetch(self, url, limit=65536, range_header=None, **kwargs):
        if range_header.startswith("bytes=-"):
            start, end = max(0, len(self.data)-int(range_header[7:])), len(self.data)-1
        else:
            start, end = map(int, range_header[6:].split("-"))
            end = min(end, len(self.data)-1)
        data = self.data[start:end+1]
        header = f"bytes {start+1 if self.wrong_range else start}-{end}/{len(self.data)}"
        return data, {"content-range": header}, 206, False


def zip_bytes(files):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


class AuditTests(unittest.TestCase):
    def test_colmap_roles_require_one_directory_and_preserve_binary_preference(self):
        models, cameras = audit.model_sets(["a/cameras.bin", "a/cameras.txt", "a/images.txt", "a/points3D.bin", "b/cameras.bin", "c/images.bin"])
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0]["files"]["cameras"], "a/cameras.bin")
        self.assertEqual(cameras, [])
        self.assertEqual(audit.model_sets(["a/cameras.bin", "a/images.bin"])[1][0]["directory"], "a")

    def test_ply_requires_complete_nonempty_typed_xyz_header(self):
        header = b"ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n"
        self.assertEqual(audit.ply_header(header)["format"], "point_cloud_ply")
        for invalid in (header.replace(b"vertex 2", b"vertex 0"), header.replace(b"float x", b"string x"), header.replace(b"end_header", b""), header.replace(b"float z", b"float intensity")):
            with self.assertRaises(ValueError):
                audit.ply_header(invalid)

    def test_colmap_rejects_empty_cameras_and_invalid_pose_quaternions(self):
        with self.assertRaises(ValueError):
            audit.colmap_header("cameras.bin", struct.pack("<Q", 0), "cameras")
        valid = struct.pack("<QI4d3dI", 1, 1, 1, 0, 0, 0, 0, 0, 0, 1)
        self.assertEqual(audit.colmap_header("images.bin", valid, "images")["records"], 1)
        for quaternion in ((0, 0, 0, 0), (float("nan"), 0, 0, 0)):
            invalid = struct.pack("<QI4d3dI", 1, 1, *quaternion, 0, 0, 0, 1)
            with self.assertRaises(ValueError):
                audit.colmap_header("images.bin", invalid, "images")

    def test_image_only_archives_are_enumerated_without_claiming_a_model(self):
        network = MemoryNetwork(zip_bytes({"crops/a.jpg": b"pixels are never decoded", "labels.json": json.dumps({"n_points": 42})}))
        result = audit.probe_zip(network, "https://example.org/images.zip", time.monotonic()+5)
        self.assertEqual(result["members"], 2)
        self.assertNotIn("format", result)
        self.assertTrue(result["completeDirectory"])

    def test_nested_archives_prevent_exhaustive_negative_claims(self):
        network = MemoryNetwork(zip_bytes({"inner.zip": zip_bytes({"points.ply": b"not inspected"})}))
        result = audit.probe_zip(network, "https://example.org/nested.zip", time.monotonic()+5)
        self.assertEqual(result["nestedArchives"], 1)

    def test_camera_only_and_conversion_assets_remain_distinct(self):
        network = MemoryNetwork(zip_bytes({"scene/cameras.bin": b"", "scene/images.bin": b""}))
        self.assertEqual(audit.probe_zip(network, "https://example.org/a.zip", time.monotonic()+5)["format"], "camera_only")
        network = MemoryNetwork(zip_bytes({"scene/cameras.npz": b"numpy metadata"}))
        self.assertEqual(audit.probe_zip(network, "https://example.org/b.zip", time.monotonic()+5)["format"], "camera_metadata")

    def test_incorrect_ranges_are_rejected(self):
        network = MemoryNetwork(zip_bytes({"data": b"test"}), wrong_range=True)
        with self.assertRaises(ValueError):
            audit.RemoteZip(network, "https://example.org/a.zip", time.monotonic()+5)
        with self.assertRaises(ValueError):
            audit.probe_file(network, "https://example.org/a.ply", "a.ply", time.monotonic()+5)

    def test_nonpublic_metadata_never_triggers_asset_reads(self):
        class NoDownloads:
            def fetch(self, *args, **kwargs):
                raise AssertionError("Private content must not be requested")
        with tempfile.TemporaryDirectory() as directory:
            result = audit.audit_repo(NoDownloads(), {"id": "owner/source", "status": "direct_colmap"},
                {"availability": "not_public"}, Path(directory))
        self.assertEqual(result["level"], "unavailable")


if __name__ == "__main__":
    unittest.main()
