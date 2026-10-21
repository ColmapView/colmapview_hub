import struct
import unittest

from scripts.audit.audit_native_layouts import inspect_header


def camera(camera_id=1, width=1024):
    return struct.pack('<iiQQdddd', camera_id, 1, width, 1024, 900, 900, 512, 512)


def image(name=b'00000001.png', observations=0):
    return struct.pack('<QIdddddddI', 1, 7, 1, 0, 0, 0, 0, 0, 0, 2) + name + b'\0' + struct.pack('<Q', observations)


class NativeHeaderTests(unittest.TestCase):
    def test_reads_every_calibration_and_rejects_trailing_or_truncated_records(self):
        raw = struct.pack('<Q', 2) + camera() + camera(2)
        result = inspect_header('cameras.bin', 'cameras', raw, len(raw))
        self.assertEqual(set(result['calibrations']), {1, 2})
        for body, size in [(raw[:-1], len(raw)), (raw + b'x', len(raw) + 1)]:
            with self.subTest(size=size), self.assertRaises(ValueError):
                inspect_header('cameras.bin', 'cameras', body, size)

    def test_rejects_duplicate_or_invalid_cameras_beyond_first_record(self):
        for second in [camera(), camera(2, 0)]:
            raw = struct.pack('<Q', 2) + camera() + second
            with self.subTest(second=second), self.assertRaises(ValueError):
                inspect_header('cameras.bin', 'cameras', raw, len(raw))

    def test_registered_photo_sample_preserves_name_camera_and_observation_bounds(self):
        raw = image(b'photos/a.png', 3)
        result = inspect_header('images.bin', 'images', raw, len(raw) + 3 * 24)
        self.assertEqual(result['sample'], {'name': 'photos/a.png', 'cameraId': 2, 'imageId': 7, 'observations': 3})
        with self.assertRaisesRegex(ValueError, 'observation count'):
            inspect_header('images.bin', 'images', raw, len(raw))

    def test_sample_cannot_escape_photo_prefix(self):
        for name in [b'../a.png', b'/a.png', b'a\\b.png', b'a?x.png', b'a//b.png']:
            raw = image(name)
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Unsafe'):
                inspect_header('images.bin', 'images', raw, len(raw))

    def test_declared_point_total_must_fit_source_bytes(self):
        raw = struct.pack('<QQdddBBBdQ', 3, 1, 0, 0, 0, 0, 0, 0, 0, 0)
        with self.assertRaisesRegex(ValueError, 'exceed'):
            inspect_header('points3D.bin', 'points3d', raw, len(raw))


if __name__ == '__main__':
    unittest.main()
