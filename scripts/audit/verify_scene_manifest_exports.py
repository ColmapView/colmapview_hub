"""Independently check binary native/XYZ PLY COLMAP + images exports.

Run offline with numpy, Pillow and pycolmap. Source bytes must already be in the
URL-hash cache; this verifier does not download anything or publish a policy.
Browser receipts and screenshots are collected separately with the real viewer.
"""

import argparse
from collections import Counter
import hashlib
import io
import json
from pathlib import Path
import tempfile
from urllib.parse import quote
import zipfile

import numpy as np
from PIL import Image
import pycolmap

from ..catalog.scene_manifests import selection_digest


def file_hash(path):
    result = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def source_url(scene, path):
    return ('https://huggingface.co/datasets/' + quote(scene['sourceId'][3:], safe='/')
            + '/resolve/' + scene['revision'] + '/' + quote(path, safe='/'))


def cached_source(scene, receipt, cache):
    path = cache / (hashlib.sha256(source_url(scene, receipt['sourcePath']).encode()).hexdigest() + '.bin')
    if not path.is_file() or path.stat().st_size != receipt['bytes'] or file_hash(path) != receipt['sha256']:
        raise ValueError('Source cache differs from the pinned byte receipt: ' + receipt['sourcePath'])
    return path


def xyz_ply(path, count):
    with path.open('rb') as file:
        header = b''
        while not header.endswith(b'end_header\n'):
            line = file.readline(65537)
            if not line or len(header) + len(line) > 65536:
                raise ValueError('Invalid or oversized PLY header')
            header += line
    lines = header.decode('ascii').splitlines()
    if lines[:2] != ['ply', 'format binary_little_endian 1.0'] or f'element vertex {count}' not in lines:
        raise ValueError('This independent verifier requires a binary little-endian XYZ PLY')
    scalar_types = {'float': '<f4', 'double': '<f8', 'uchar': 'u1', 'uint8': 'u1'}
    properties = []
    for line in lines:
        if line.startswith('property '):
            _, kind, name = line.split()
            properties.append((name, scalar_types[kind]))
    dtype = np.dtype(properties)
    if path.stat().st_size != len(header) + count * dtype.itemsize:
        raise ValueError('PLY payload does not match its declared vertices')
    return np.memmap(path, dtype=dtype, offset=len(header), mode='r', shape=(count,))


def verify_points(source, output, count):
    dtype = np.dtype([('id', '<u8'), ('xyz', '<f8', (3,)), ('rgb', 'u1', (3,)), ('error', '<f8'), ('tracks', '<u8')])
    with output.open('rb') as file:
        declared = int.from_bytes(file.read(8), 'little')
    if declared != count or output.stat().st_size != 8 + count * dtype.itemsize:
        raise ValueError('Exported point count or untracked record framing differs')
    points = np.memmap(output, dtype=dtype, offset=8, mode='r', shape=(count,))
    original = None
    try:
        original = xyz_ply(source, count)
        for start in range(0, count, 100000):
            stop = min(count, start + 100000)
            chunk = points[start:stop]
            xyz = np.column_stack([original[axis][start:stop] for axis in ('x', 'y', 'z')])
            colors = [channel in original.dtype.names for channel in ('red', 'green', 'blue')]
            if any(colors) and not all(colors):
                raise ValueError('Partial PLY color declarations are not supported by this independent verifier')
            rgb = (np.column_stack([original[channel][start:stop] for channel in ('red', 'green', 'blue')])
                   if all(colors) else np.full((stop - start, 3), 255, dtype='u1'))
            if (not np.isfinite(xyz).all() or not np.array_equal(chunk['xyz'], xyz)
                    or not np.array_equal(chunk['rgb'], rgb) or np.any(chunk['tracks']) or np.any(chunk['error'])
                    or not np.array_equal(chunk['id'], np.arange(start + 1, stop + 1, dtype='<u8'))):
                raise ValueError('Exported point values, colors, IDs or tracks differ from the source PLY')
    finally:
        # Close explicitly even on failure: Windows cannot remove a mapped export.
        points._mmap.close()
        if original is not None:
            original._mmap.close()


def native_component_delta(expected, actual):
    """Accept original values or their exact viewer float32 representation."""
    expected, actual = np.asarray(expected, dtype=np.float64), np.asarray(actual, dtype=np.float64)
    if (expected.shape != actual.shape or not np.isfinite(expected).all() or not np.isfinite(actual).all()
            or not np.logical_or(expected == actual, expected.astype(np.float32).astype(np.float64) == actual).all()):
        raise ValueError('Native point component differs from its source or exact float32 rounding')
    return float(np.max(np.abs(expected - actual))) if expected.size else 0.0


def verify_native_points(original, selected):
    if set(original.points3D) != set(selected.points3D):
        raise ValueError('Native point IDs differ')
    result = {'maxPointPositionDelta': 0.0, 'maxPointErrorDelta': 0.0, 'tracks': 0}
    for point_id, point in original.points3D.items():
        output = selected.points3D[point_id]
        if not np.array_equal(point.color, output.color):
            raise ValueError('Native point colors differ')
        result['maxPointPositionDelta'] = max(result['maxPointPositionDelta'], native_component_delta(point.xyz, output.xyz))
        result['maxPointErrorDelta'] = max(result['maxPointErrorDelta'], native_component_delta(point.error, output.error))
        tracks = Counter((item.image_id, item.point2D_idx) for item in point.track.elements)
        exported_tracks = Counter((item.image_id, item.point2D_idx) for item in output.track.elements)
        if tracks != exported_tracks:
            raise ValueError('Native point tracks differ')
        for (image_id, index), count in exported_tracks.items():
            if (image_id not in selected.images or not 0 <= index < len(selected.images[image_id].points2D)
                    or selected.images[image_id].points2D[index].point3D_id != point_id):
                raise ValueError('Native point track does not resolve to its exported observation')
            result['tracks'] += count
    return result


def scene_id(scene):
    return 'data-' + hashlib.sha256('\0'.join([scene['sourceId'], scene['kind'], '', scene['path']]).encode()).hexdigest()[:24]


def browser_receipts(folder):
    receipts = {}
    for path in folder.glob('*.log'):
        lines = path.read_text(encoding='utf-8-sig').splitlines()
        if len(lines) > 1 and lines[0] == '### Result':
            receipt = json.loads(lines[1])
            if isinstance(receipt, dict) and receipt.get('status') == 'passed' and receipt.get('id'):
                receipts[receipt['id']] = receipt
    return receipts


def verify_scene(scene, receipt, exports, cache, scratch):
    identity = scene_id(scene)
    counts = scene['counts']
    if (not receipt or receipt.get('errors') or receipt.get('pointDrawCount') != counts['points']
            or receipt.get('photoCount') != len(scene['photos']) or receipt.get('maskCount') != len(scene['masks'])):
        raise ValueError('Missing or mismatched complete browser import/renderer receipt: ' + identity)
    point_format = scene['points']['format']
    if len(scene['photos']) != counts['images'] or point_format not in ('xyz_ply', 'colmap_binary'):
        raise ValueError('This export check requires all original photos and binary native/XYZ PLY points')
    archive_path = exports / (identity + '.zip')
    source_files = {role: cached_source(scene, scene['modelFiles'][role], cache) for role in ('cameras', 'images')}
    source_cloud = cached_source(scene, scene['points'], cache)
    scratch = scratch.resolve()
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='manifest-export-', dir=scratch) as directory:
        temporary = Path(directory).resolve()
        if not temporary.is_relative_to(scratch):
            raise ValueError('Verification directory must stay in its scratch root')
        native, exported = temporary / 'native', temporary / 'export'
        native.mkdir(); exported.mkdir()
        for role, source in source_files.items():
            if not scene['modelFiles'][role]['sourcePath'].endswith('.bin'):
                raise ValueError('This verifier requires original binary cameras and poses')
            (native / (role + '.bin')).write_bytes(source.read_bytes())
        (native / 'points3D.bin').write_bytes(source_cloud.read_bytes() if point_format == 'colmap_binary' else bytes(8))
        original = pycolmap.Reconstruction(str(native))
        names = {image.name for image in original.images.values()}
        photo_cameras = {image.name: original.cameras[image.camera_id] for image in original.images.values()}
        if (names != {photo['name'] for photo in scene['photos']}
                or point_format == 'xyz_ply' and any(image.num_points3D for image in original.images.values())):
            raise ValueError('Source names or existing observation references disagree with the point selection')
        with zipfile.ZipFile(archive_path) as archive:
            if len(archive.namelist()) != len(set(archive.namelist())):
                raise ValueError('Duplicate paths in exported scene')
            expected = {'sparse/0/' + name for name in ('cameras.bin', 'images.bin', 'points3D.bin')}
            expected.update('images/' + photo['name'] for photo in scene['photos'])
            if set(archive.namelist()) != expected:
                raise ValueError('Export is incomplete or contains unexpected paths')
            for name in ('cameras', 'images', 'points3D'):
                # Only these three fixed file names are written; source ZIP paths are never extracted.
                with archive.open('sparse/0/' + name + '.bin') as source, (exported / (name + '.bin')).open('wb') as target:
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
            for photo in scene['photos']:
                cached_source(scene, photo, cache)
                body = archive.read('images/' + photo['name'])
                if len(body) != photo['bytes'] or hashlib.sha256(body).hexdigest() != photo['sha256']:
                    raise ValueError('Original photograph bytes changed: ' + photo['name'])
                with Image.open(io.BytesIO(body)) as image:
                    image.load()
                    calibration = photo_cameras[photo['name']]
                    if (image.size != (photo['width'], photo['height']) or image.size != (calibration.width, calibration.height)
                            or image.getexif().get(274, 1) != 1):
                        raise ValueError('Photograph dimensions or orientation disagree with the calibration')
        if point_format == 'xyz_ply':
            verify_points(source_cloud, exported / 'points3D.bin', counts['points'])
        selected = pycolmap.Reconstruction(str(exported))
        if (selected.num_cameras(), selected.num_reg_images(), selected.num_points3D()) != (counts['cameras'], counts['images'], counts['points']):
            raise ValueError('Independent COLMAP counts differ')
        if set(original.cameras) != set(selected.cameras) or set(original.images) != set(selected.images):
            raise ValueError('Native camera or image IDs differ')
        precision = verify_native_points(original, selected) if point_format == 'colmap_binary' else None
        for camera_id, camera in original.cameras.items():
            exported_camera = selected.cameras[camera_id]
            if (camera.model != exported_camera.model or camera.width != exported_camera.width or camera.height != exported_camera.height
                    or not np.array_equal(camera.params, exported_camera.params)):
                raise ValueError('Exported calibration differs')
        for image_id, image in original.images.items():
            exported_image = selected.images[image_id]
            if (image.name != exported_image.name or image.camera_id != exported_image.camera_id
                    or not np.allclose(image.cam_from_world().matrix(), exported_image.cam_from_world().matrix(), atol=1e-12, rtol=1e-12)
                    or len(image.points2D) != len(exported_image.points2D)
                    or any(a.point3D_id != b.point3D_id or not np.array_equal(a.xy, b.xy)
                           for a, b in zip(image.points2D, exported_image.points2D))
                    or exported_image.num_points3D != image.num_points3D):
                raise ValueError('Exported pose or observation references differ')
        # Release C++ point maps before the next multi-million-point model.
        del original, selected
    for mask in scene['masks']:
        with Image.open(cached_source(scene, mask, cache)) as image:
            image.load()
            if image.size != (mask['width'], mask['height']):
                raise ValueError('Mask dimensions differ')
    return {'id': identity, 'status': 'passed', 'counts': counts, 'photos': len(scene['photos']), 'masks': len(scene['masks']),
            'selectionSha256': selection_digest(scene), 'exportSha256': file_hash(archive_path),
            **({'nativeExportPrecision': precision} if precision is not None else {}),
            'checks': {key: 'passed' for key in ('modelExport', 'independentColmapRead', 'cameraCalibration', 'cameraPoses',
                       'pointValues', 'originalPhotoHashes', 'photoDecode', 'maskDecode')}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('scenes', 'browser-reports', 'exports', 'cache', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    scenes = json.loads(args.scenes.read_text(encoding='utf-8'))
    if isinstance(scenes, dict):
        scenes = scenes['scenes']
    receipts = browser_receipts(args.browser_reports)
    results = []
    for scene in scenes:
        result = verify_scene(scene, receipts.get(scene_id(scene)), args.exports, args.cache, args.output.parent / 'export-check')
        results.append(result)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({'status': 'passed', 'scenes': results}, indent=2), encoding='utf-8')
        print(json.dumps(result, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    main()
