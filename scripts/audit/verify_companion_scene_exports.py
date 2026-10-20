"""Offline checks for native or metadata manifests with untracked XYZ/NPZ geometry.

Use a URL-hash source cache and actual browser exports. No network calls or policy
publication occur here. Large point streams are compared in bounded chunks.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tempfile
import zipfile

import numpy as np
import pycolmap
from PIL import Image

from .verify_camera_model_exports import close, params, pose
from .verify_scene_manifest_exports import cached_source, file_hash, native_component_delta, scene_id, xyz_ply


def verify_cloud(scene, cache, output):
    cloud, count = scene['points'], scene['counts']['points']
    source = cached_source(scene, cloud, cache)
    dtype = np.dtype([('id', '<u8'), ('xyz', '<f8', (3,)), ('rgb', 'u1', (3,)), ('error', '<f8'), ('tracks', '<u8')])
    with output.open('rb') as file:
        declared = int.from_bytes(file.read(8), 'little')
    if declared != count or output.stat().st_size != 8 + count * dtype.itemsize:
        raise ValueError('Point count or untracked binary framing differs')
    points = np.memmap(output, dtype=dtype, offset=8, mode='r', shape=(count,))
    original = xyz_ply(source, count) if cloud['format'] == 'xyz_ply' else None
    trajectory = None
    if original is None:
        with np.load(source, allow_pickle=False) as arrays:
            trajectory = arrays[cloud['array']]
        if trajectory.ndim != 3 or trajectory.shape[1:] != (count, 3) or not 0 <= cloud['frame'] < len(trajectory):
            raise ValueError('Temporal source shape or selected frame differs')
    transform = np.asarray(cloud['transform']).reshape(4, 4) if 'transform' in cloud else None
    delta = 0.
    try:
        for start in range(0, count, 100000):
            stop = min(start + 100000, count)
            xyz = (np.column_stack([original[key][start:stop] for key in ('x', 'y', 'z')]) if original is not None
                   else trajectory[cloud['frame'], start:stop])
            if transform is not None:
                xyz = (xyz.astype(float) @ transform[:3, :3].T + transform[:3, 3]).astype('f4')
            rgb = (np.column_stack([original[key][start:stop] for key in ('red', 'green', 'blue')])
                   if original is not None and all(key in original.dtype.names for key in ('red', 'green', 'blue'))
                   else np.full((stop - start, 3), 255, dtype='u1'))
            chunk = points[start:stop]
            delta = max(delta, native_component_delta(xyz, chunk['xyz']))
            if (not np.array_equal(rgb, chunk['rgb']) or chunk['tracks'].any() or chunk['error'].any()
                    or not np.array_equal(chunk['id'], np.arange(start + 1, stop + 1, dtype='<u8'))):
                raise ValueError('XYZ colors, IDs, tracks or errors differ')
    finally:
        points._mmap.close()
        if original is not None:
            original._mmap.close()
    return {'maxPointPositionDelta': delta}


def verify_metadata(scene, cache, model, result):
    receipt = scene['modelFiles']['metadata']
    raw = cached_source(scene, receipt, cache).read_bytes()
    if receipt['sourcePath'].endswith('.json'):
        source = json.loads(raw)
        indices = scene.get('frameIndices', list(range(len(source['frames']))))
        if len(source['frames']) != scene['sourceCounts']['images'] or len(indices) != model.num_reg_images():
            raise ValueError('Original camera frames or selected subset differ')
        resize = scene.get('resizePolicy', {}).get('factor', 1)
        if 'transform' in scene['points']:
            reference = json.loads(cached_source(scene, scene['modelFiles']['referenceCameras'], cache).read_bytes())
            named = {Path(frame['file_path']).name: frame for frame in source['frames']}
            if len(named) != len(reference) or len(named) != len(source['frames']):
                raise ValueError('Source cloud/camera association is ambiguous or incomplete')
            transform = np.asarray(scene['points']['transform']).reshape(4, 4)
            scale = np.linalg.norm(transform[:3, 0])
            max_delta = 0.
            for camera in reference:
                frame = named[camera['img_name']]
                expected = np.asarray(frame['transform_matrix']).copy(); expected[:3, 1:3] *= -1
                actual = np.eye(4)
                actual[:3, :3] = transform[:3, :3] @ np.asarray(camera['rotation']) / scale
                actual[:3, 3] = transform[:3, :3] @ np.asarray(camera['position']) + transform[:3, 3]
                max_delta = max(max_delta, float(np.max(np.abs(expected - actual))))
            if max_delta > 1e-10:
                raise ValueError('Cloud-to-metadata transform disagrees with original source camera poses')
            result['worldTransformMaxPoseDelta'] = max_delta
        for index, (image_id, image) in enumerate(sorted(model.images.items())):
            if image_id != index + 1:
                raise ValueError('Selected camera order differs')
            frame = source['frames'][indices[index]]
            matrix = np.asarray(frame['transform_matrix'])
            pose(image, np.diag([1, -1, -1]) @ matrix[:3, :3].T, matrix[:3, 3], result)
            camera = model.cameras[image.camera_id]
            params(source, frame, camera, (camera.width, camera.height), resize_factor=resize)
            name = frame['file_path'].lstrip('./')
            if resize != 1:
                name = name.replace('images/', f'images_{resize}/', 1)
            if name != image.name:
                raise ValueError('Registered photo reference differs from its source frame')
            if scene['points']['format'] == 'numpy_frame':
                with np.load(cached_source(scene, scene['points'], cache), allow_pickle=False) as arrays:
                    frames = arrays[scene['points']['array']].shape[0]
                time = scene['points']['frame'] / max(1, frames - 1)
                if not np.isclose(frame.get('time', np.nan), time, atol=1e-12, rtol=0):
                    raise ValueError('Source vertex frame and photograph time disagree')
        result['cameraSourceFramesChecked'] = 'passed'
    else:
        with np.load(io.BytesIO(raw), allow_pickle=False) as arrays:
            if len([key for key in arrays.files if key.startswith('world_mat_') and key[len('world_mat_'):].isdigit()]) != model.num_reg_images():
                raise ValueError('DTU camera count differs')
            for index, (image_id, image) in enumerate(sorted(model.images.items())):
                if image_id != index + 1 or int(Path(image.name).stem) != index:
                    raise ValueError('DTU image order differs')
                projection = (arrays[f'world_mat_{index}'].astype(float) @ arrays[f'scale_mat_{index}'].astype(float))[:3]
                q, r = np.linalg.qr(np.flipud(projection[:, :3]).T)
                k, rotation = np.fliplr(np.flipud(r.T)), np.flipud(q.T)
                signs = np.sign(np.diag(k)); k, rotation = k @ np.diag(signs), np.diag(signs) @ rotation
                if np.linalg.det(rotation) < 0:
                    k, rotation = -k, -rotation
                k /= k[2, 2]
                pose(image, rotation, -np.linalg.solve(projection[:, :3], projection[:, 3]), result)
                close([k[0, 0], k[1, 1], k[0, 2], k[1, 2]], model.cameras[image.camera_id].params, 'DTU calibration', atol=1e-7)


def verify(scene, browser, exports, cache, scratch):
    identity = scene_id(scene)
    if (not browser or browser.get('status') != 'passed' or browser.get('errors')
            or browser.get('counts') != scene['counts'] or browser.get('pointDrawCount') != scene['counts']['points']):
        raise ValueError('Missing matching browser model/renderer receipt')
    archive_path = exports / (identity + '.zip')
    if file_hash(archive_path) != browser['exportSha256']:
        raise ValueError('Export ZIP differs from its browser receipt')
    result = {'id': identity, 'sourceId': scene['sourceId'], 'status': 'passed', 'counts': scene['counts'],
              'sourceSha256': scene['points']['sha256'], 'exportSha256': browser['exportSha256'],
              'maxSourceRotationDelta': 0., 'maxCameraCenterDelta': 0.}
    with tempfile.TemporaryDirectory(prefix='companion-proof-', dir=scratch) as directory:
        folder = Path(directory)
        with zipfile.ZipFile(archive_path) as archive:
            expected = {'sparse/0/' + name + '.bin' for name in ('cameras', 'images', 'points3D')}
            expected.update('images/' + photo['name'] for photo in scene['photos'])
            if len(archive.namelist()) != len(set(archive.namelist())) or set(archive.namelist()) != expected:
                raise ValueError('Export paths or photo selection differ')
            for name in ('cameras', 'images', 'points3D'):
                with archive.open('sparse/0/' + name + '.bin') as source, (folder / (name + '.bin')).open('wb') as target:
                    while chunk := source.read(1024 * 1024):
                        target.write(chunk)
            for photo in scene['photos']:
                body = archive.read('images/' + photo['name'])
                if len(body) != photo['bytes'] or hashlib.sha256(body).hexdigest() != photo['sha256']:
                    raise ValueError('Original photograph bytes changed')
                with Image.open(io.BytesIO(body)) as image:
                    image.load()
                    if image.size != (photo['width'], photo['height']):
                        raise ValueError('Photograph dimensions differ')
        result.update(verify_cloud(scene, cache, folder / 'points3D.bin'))
        # C++ independently reads cameras and every feature; points were checked in bounded chunks.
        (folder / 'points3D.bin').write_bytes(bytes(8))
        model = pycolmap.Reconstruction(str(folder))
        if (model.num_cameras(), model.num_reg_images()) != (scene['counts']['cameras'], scene['counts']['images']) or any(image.num_points3D for image in model.images.values()):
            raise ValueError('Camera counts or untracked observations differ')
        sample = browser.get('sample')
        if sample:
            with Image.open(cached_source(scene, sample, cache)) as image:
                image.load()
                if image.size != (sample['width'], sample['height']):
                    raise ValueError('Bound photograph sample dimensions differ')
            registered = next(image for image in model.images.values() if image.name == sample['name'])
            camera = model.cameras[registered.camera_id]
            if (camera.width, camera.height) != (sample['width'], sample['height']):
                raise ValueError('Bound photograph and camera dimensions differ')
            result['photoSample'] = 'passed'
        if scene['kind'] == 'camera-scene':
            verify_metadata(scene, cache, model, result)
        else:
            original_path = folder / 'original'; original_path.mkdir()
            for role in ('cameras', 'images'):
                (original_path / (role + '.bin')).write_bytes(cached_source(scene, scene['modelFiles'][role], cache).read_bytes())
            (original_path / 'points3D.bin').write_bytes(bytes(8))
            original = pycolmap.Reconstruction(str(original_path))
            if set(original.cameras) != set(model.cameras) or set(original.images) != set(model.images):
                raise ValueError('Native camera/image IDs differ')
            for key, camera in original.cameras.items():
                actual = model.cameras[key]
                if camera.model != actual.model or camera.width != actual.width or camera.height != actual.height or not np.array_equal(camera.params, actual.params):
                    raise ValueError('Native calibration differs')
            for key, image in original.images.items():
                actual = model.images[key]
                if (image.name != actual.name or image.camera_id != actual.camera_id or len(image.points2D) != len(actual.points2D)
                        or not np.allclose(image.cam_from_world().matrix(), actual.cam_from_world().matrix(), atol=1e-12, rtol=1e-12)
                        or any(not np.array_equal(a.xy, b.xy) for a, b in zip(image.points2D, actual.points2D))):
                    raise ValueError('Native pose or retained feature coordinates differ')
            result['unlinkedSourceObservations'] = sum(image.num_points3D for image in original.images.values())
    result['pointValues'] = 'passed'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', type=Path, default=Path('data/scene-manifests.json'))
    parser.add_argument('--scene', action='append', required=True)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--exports', type=Path, required=True)
    parser.add_argument('--cache', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    scenes = {scene_id(scene): scene for scene in json.loads(args.policy.read_bytes())['scenes']}
    browser = {row['id']: row for row in json.loads(args.browser.read_bytes())}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    results = [verify(scenes[identity], browser.get(identity), args.exports, args.cache, args.output.parent) for identity in args.scene]
    args.output.write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'scenes': len(results), 'points': sum(row['counts']['points'] for row in results)}))


if __name__ == '__main__':
    main()
