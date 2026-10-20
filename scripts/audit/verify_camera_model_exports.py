"""Independently compare complete original camera metadata with viewer model exports.

Run offline with NumPy, Pillow and PyCOLMAP. Browser receipts and source responses
are collected separately; this command never downloads or publishes source data.
"""
import argparse
import hashlib
import io
import posixpath
import json
import math
import re
from pathlib import Path
import tempfile
import zipfile
import numpy as np
import pycolmap
from PIL import Image
from .verify_scene_manifest_exports import verify_points


def close(expected, actual, label, atol=1e-9, rtol=1e-12):
    if not np.allclose(expected, actual, atol=atol, rtol=rtol):
        raise ValueError(label + ' differs; max delta ' + str(np.max(np.abs(np.asarray(expected) - np.asarray(actual)))))

def params(root, frame, camera, reference_size=None):
    values = {**root, **frame}
    width, height = int(values.get('w', camera.width)), int(values.get('h', camera.height))
    if 'w' not in values or 'h' not in values:
        if reference_size is None:
            raise ValueError('Undeclared calibration dimensions lack an original photo header')
        close([width, height], reference_size, 'Original photograph dimensions', atol=0, rtol=0)
    close([width, height], [camera.width, camera.height], 'Declared calibration dimensions', atol=0, rtol=0)
    def focal(axis, pixels):
        if 'fl_' + axis in values:
            return values['fl_' + axis]
        if 'camera_angle_' + axis in values:
            return pixels / (2 * math.tan(values['camera_angle_' + axis] / 2))
        if axis + '_fov' in values:
            return pixels / (2 * math.tan(math.radians(values[axis + '_fov']) / 2))
        return None
    fx, fy = focal('x', width), focal('y', height)
    fx, fy = fx if fx is not None else fy, fy if fy is not None else fx
    distortion = [float(values.get(key, 0)) for key in ['k1', 'k2', 'k3', 'k4', 'p1', 'p2']]
    model = values.get('camera_model', 'OPENCV_FISHEYE' if values.get('is_fisheye') else 'OPENCV' if any(distortion) else 'PINHOLE')
    expected = [fx, fy, values.get('cx', width / 2), values.get('cy', height / 2)]
    if model in ('PINHOLE', 'SIMPLE_PINHOLE'):
        model = 'PINHOLE'
    elif model == 'OPENCV_FISHEYE':
        expected += distortion[:4]
    elif model == 'OPENCV':
        expected += [distortion[0], distortion[1], distortion[4], distortion[5]]
        if distortion[2]:
            model = 'FULL_OPENCV'; expected += [distortion[2], 0, 0, 0]
    else:
        raise ValueError('Independent camera mapping is unavailable for ' + str(model))
    if camera.model.name != model:
        raise ValueError('Camera model differs from original declaration')
    close(expected, camera.params, 'Camera intrinsics')

def pose(image, rotation, center, result):
    actual = image.cam_from_world().rotation.matrix()
    delta = float(np.max(np.abs(actual - rotation)))
    # The importer's source rotation guard permits 1e-5 orthogonality error;
    # quaternion export normalizes it. Retain the measured source difference.
    close(rotation, actual, 'Source rotation', atol=2e-5, rtol=0)
    actual_center = image.projection_center()
    close(center, actual_center, 'World camera center')
    result['maxSourceRotationDelta'] = max(result['maxSourceRotationDelta'], delta)
    result['maxCameraCenterDelta'] = max(result['maxCameraCenterDelta'], float(np.max(np.abs(actual_center - center))))

def rodrigues(vector):
    vector = np.asarray(vector); angle = np.linalg.norm(vector)
    if angle == 0: return np.eye(3)
    x, y, z = vector / angle
    cross = np.array([[0, -z, y], [z, 0, -x], [-y, x, 0]])
    return np.eye(3) + math.sin(angle) * cross + (1 - math.cos(angle)) * (cross @ cross)

def verify_opensfm_points(source, model, result):
    """OpenSfM JSON contains XYZ/RGB, while observations live in tracks.csv."""
    points = source.get('points', {})
    if not isinstance(points, dict):
        raise ValueError('Invalid OpenSfM source points')
    numeric = all(re.fullmatch(r'0|[1-9][0-9]*', key) and len(key) <= 20 and int(key) < 2**64 - 1 for key in points)
    indexed = {int(key): value for key, value in points.items()} if numeric else {
        index + 1: points[key] for index, key in enumerate(sorted(points, key=lambda value: value.encode('utf-16-be', errors='surrogatepass')))}
    if set(model.points3D) != set(indexed):
        raise ValueError('OpenSfM source point IDs or count differ')
    for key, original in indexed.items():
        point = model.points3D[key]
        xyz = np.asarray(original['coordinates'], dtype=float)
        if not (np.array_equal(xyz, point.xyz) or np.array_equal(xyz.astype(np.float32).astype(float), point.xyz)):
            raise ValueError('OpenSfM point coordinates differ beyond viewer float32 precision')
        if not np.array_equal(original['color'], point.color) or point.error != 0 or len(point.track.elements):
            raise ValueError('OpenSfM source colors differ or observations/errors were fabricated')
    if any(len(image.points2D) for image in model.images.values()):
        raise ValueError('OpenSfM JSON must not synthesize image observations')
    result.update(pointValues='passed', pointObservations=0, pointPrecision='source_or_float32')


def verify_openmvg_structure(source, model, result):
    """Check every landmark and reciprocal observation, joining by source view ID."""
    landmarks = source.get('structure', [])
    if not isinstance(landmarks, list) or len({row['key'] for row in landmarks}) != len(landmarks):
        raise ValueError('Invalid or duplicate OpenMVG landmarks')
    if set(model.points3D) != {row['key'] for row in landmarks}:
        raise ValueError('OpenMVG source landmark IDs or count differ')
    images = {row['key']: model.images[index + 1] for index, row in enumerate(source['views']) if index + 1 in model.images}
    observations = 0
    for row in landmarks:
        point = model.points3D[row['key']]
        source_point = np.asarray(row['value']['X'], dtype=float)
        # The existing WASM export realizes geometry from float32 render buffers.
        # Accept exactly source values or their float32 representation, not an arbitrary tolerance.
        if not (np.array_equal(source_point, point.xyz)
                or np.array_equal(source_point.astype(np.float32).astype(float), point.xyz)):
            raise ValueError('OpenMVG landmark coordinates differ beyond viewer float32 precision')
        expected = {images[obs['key']].image_id: obs['value']['x'] for obs in row['value']['observations'] if obs['key'] in images}
        if len(point.track.elements) != len(expected) or {item.image_id for item in point.track.elements} != set(expected):
            raise ValueError('OpenMVG landmark observations differ')
        errors = []
        for item in point.track.elements:
            image = model.images[item.image_id]
            observation = image.points2D[item.point2D_idx]
            if observation.point3D_id != row['key']:
                raise ValueError('OpenMVG image/point reference is not reciprocal')
            close(expected[item.image_id], observation.xy, 'OpenMVG observation coordinates', atol=0, rtol=0)
            projected = model.cameras[image.camera_id].img_from_cam(image.cam_from_world() * source_point)
            if projected is not None and np.isfinite(projected).all():
                errors.append(float(np.linalg.norm(projected - observation.xy)))
            observations += 1
        close(float(np.mean(errors)) if errors else 0, point.error, 'OpenMVG computed reprojection error', atol=1e-8, rtol=np.finfo(np.float32).eps)
    if sum(len(image.points2D) for image in model.images.values()) != observations:
        raise ValueError('OpenMVG image observations contain unverified entries')
    result.update(pointValues='passed', pointObservations=observations, pointPrecision='source_or_float32')


def verify_scene_exports(root, output, frame_coverage):
    scenes = json.loads((root / 'model-browser-results.json').read_bytes())
    photos = json.loads((root / 'reference-photos.json').read_bytes())
    results = []
    for scene in scenes:
        if scene['status'] != 'exported':
            continue
        result = {'id': scene['id'], 'sourceId': scene['sourceId'], 'status': 'review_required',
                  'maxSourceRotationDelta': 0.0, 'maxCameraCenterDelta': 0.0}
        try:
            raw_source = (root / 'model-source' / (scene['id'] + '.bin')).read_bytes()
            archive_bytes = (root / 'exports' / (scene['id'] + '.zip')).read_bytes()
            if len(raw_source) != scene['sourceReceipt']['bytes'] or hashlib.sha256(raw_source).hexdigest() != scene['sourceReceipt']['sha256'] or hashlib.sha256(archive_bytes).hexdigest() != scene['exportSha256']:
                raise ValueError('Original metadata or browser export bytes differ from their receipts')
            with tempfile.TemporaryDirectory(prefix='model-proof-', dir=root) as directory:
                folder = Path(directory)
                with zipfile.ZipFile(root / 'exports' / (scene['id'] + '.zip')) as archive:
                    expected = {'sparse/0/' + name for name in ('cameras.bin', 'images.bin', 'points3D.bin')}
                    if len(archive.namelist()) != 3 or set(archive.namelist()) != expected:
                        raise ValueError('Unexpected or incomplete model-only archive')
                    for name in ('cameras.bin', 'images.bin', 'points3D.bin'):
                        (folder / name).write_bytes(archive.read('sparse/0/' + name))
                model = pycolmap.Reconstruction(str(folder))
                cloud = scene.get('companionPointCloud')
                if not model.num_reg_images() or not model.num_cameras():
                    raise ValueError('Camera model export has invalid counts')
                structure_checked = False
                if cloud:
                    source_cloud = root / 'model-source' / (scene['id'] + '.ply')
                    cloud_bytes = source_cloud.read_bytes()
                    if (cloud.get('browserRead') is not True or len(cloud_bytes) != cloud.get('bytes')
                            or hashlib.sha256(cloud_bytes).hexdigest() != cloud.get('sha256')
                            or type(cloud.get('points')) is not int or cloud['points'] < 1
                            or model.num_points3D() != cloud['points']):
                        raise ValueError('Companion point source or browser receipt differs')
                    verify_points(source_cloud, folder / 'points3D.bin', cloud['points'])
                    if any(image.num_points3D for image in model.images.values()):
                        raise ValueError('XYZ companion points must not synthesize camera observations')
                    result['pointValues'] = 'passed'
                    result['companionPointCloud'] = cloud['path']
                    structure_checked = True
                raw = (root / 'model-source' / (scene['id'] + '.bin')).read_bytes()
                reference_size = None
                if scene['id'] in photos or scene['sourceId'] in photos:
                    reference = photos.get(scene['id']) or photos[scene['sourceId']]
                    with Image.open(io.BytesIO((root / reference['path']).read_bytes())) as photo:
                        reference_size = photo.size
                images = sorted(model.images.items())
                if scene['loadUrl'].endswith('.npy'):
                    array = np.load(io.BytesIO(raw), allow_pickle=False)
                    if array.shape != (len(images), 17): raise ValueError('LLFF camera count differs')
                    names = [image.name for _, image in images]
                    if names != sorted(names): raise ValueError('LLFF original filename order differs')
                    for index, (image_id, image) in enumerate(images):
                        if image_id != index + 1: raise ValueError('LLFF frame IDs differ from original order')
                        p = array[index, :15].reshape(3, 5); camera = model.cameras[image.camera_id]
                        rotation = (p[:, [1, 0, 2]] @ np.diag([1, 1, -1])).T
                        pose(image, rotation, p[:, 3], result)
                        height, width, focal = p[:, 4]
                        expected = [focal * camera.width / width, focal * camera.height / height, camera.width / 2, camera.height / 2]
                        close(expected, camera.params, 'LLFF intrinsics')
                        if camera.model.name != 'PINHOLE': raise ValueError('Unexpected LLFF camera model')
                elif scene['loadUrl'].endswith('.npz'):
                    with np.load(io.BytesIO(raw), allow_pickle=False) as arrays:
                        for index, (image_id, image) in enumerate(images):
                            if image_id != index + 1: raise ValueError('DTU frame IDs differ from original order')
                            if not Path(image.name).stem.isdigit() or int(Path(image.name).stem) != index:
                                raise ValueError('DTU image filename differs from its original projection index')
                            projection = (arrays[f'world_mat_{index}'].astype(float) @ arrays[f'scale_mat_{index}'].astype(float))[:3, :4]
                            m = projection[:, :3]; q, r = np.linalg.qr(np.flipud(m).T)
                            k = np.fliplr(np.flipud(r.T)); rotation = np.flipud(q.T)
                            signs = np.sign(np.diag(k)); signs[signs == 0] = 1
                            k, rotation = k @ np.diag(signs), np.diag(signs) @ rotation
                            if np.linalg.det(rotation) < 0: k, rotation = -k, -rotation
                            k = k / k[2, 2]; camera = model.cameras[image.camera_id]
                            center = -np.linalg.solve(m, projection[:, 3])
                            pose(image, rotation, center, result)
                            close([k[0, 0], k[1, 1], k[0, 2], k[1, 2]], camera.params, 'DTU projection calibration', atol=1e-7)
                        if len([name for name in arrays.files if re.fullmatch(r'world_mat_\d+', name)]) != len(images): raise ValueError('DTU camera count differs')
                else:
                    source = json.loads(raw)
                    if isinstance(source, dict) and isinstance(source.get('frames'), list):
                        frames = source['frames']
                        if len(frames) != len(images):
                            coverage = frame_coverage.get(scene['id'], {})
                            listed = (root / coverage.get('listingPath', '')).read_bytes()
                            if hashlib.sha256(listed).hexdigest() != coverage.get('listingSha256') or coverage.get('listingComplete') is not True or coverage.get('listingBrowserRead') is not True:
                                raise ValueError('Partial frame inventory lacks complete source and browser receipts')
                            paths = {item['path'] for item in json.loads(listed) if item.get('type') == 'file'}
                            base = scene['loadPath'].rsplit('/', 1)[0]
                            matched = []
                            for frame_index, original_frame in enumerate(frames):
                                path = posixpath.normpath(base + '/' + original_frame['file_path'])
                                candidates = [path] if Path(path).suffix else [path + ext for ext in ('.png', '.jpg', '.jpeg', '.webp')]
                                found = [path for path in candidates if path in paths]
                                if len(found) > 1: raise ValueError('Ambiguous original RGB reference')
                                if found: matched.append(frame_index + 1)
                            if matched != coverage.get('selectedFrameIds'): raise ValueError('Selected frame IDs differ from the complete RGB inventory')
                            if coverage['metadataFrames'] != len(frames) or coverage['selectedFrameIds'] != [key for key, _ in images]:
                                raise ValueError('Original camera frame count differs')
                            result['frameCoverage'] = {key: coverage[key] for key in ('metadataFrames', 'missingRgbFrames', 'listingUrl', 'listingSha256', 'listingComplete', 'listingBrowserRead')}
                        for index, (image_id, image) in enumerate(images):
                            if image_id != index + 1 and 'frameCoverage' not in result: raise ValueError('Frame IDs do not preserve original order')
                            frame = frames[image_id - 1]; matrix = np.asarray(frame['transform_matrix'], dtype=float)
                            rotation = np.diag([1, -1, -1]) @ matrix[:3, :3].T
                            pose(image, rotation, matrix[:3, 3], result)
                            params(source, frame, model.cameras[image.camera_id], reference_size)
                            name = frame['file_path'].replace('\\', '/').lstrip('./')
                            stem = str(Path(image.name).with_suffix('')).replace('\\', '/')
                            if not (name.endswith(image.name) or name.endswith(stem)):
                                raise ValueError('Original frame reference differs from its exported name')
                    elif (isinstance(source, list) and source and 'shots' in source[0]
                          or isinstance(source, dict) and 'shots' in source and 'cameras' in source):
                        source = source[scene.get('component', 0)] if isinstance(source, list) else source
                        if len(source['shots']) != len(images): raise ValueError('OpenSfM shot count differs')
                        for _, image in images:
                            shot = source['shots'][image.name]; original_camera = source['cameras'][shot['camera']]
                            rotation = rodrigues(shot['rotation']); center = -rotation.T @ np.asarray(shot['translation'])
                            pose(image, rotation, center, result)
                            camera = model.cameras[image.camera_id]; width, height = original_camera['width'], original_camera['height']
                            if camera.model.name != 'RADIAL': raise ValueError('Unexpected OpenSfM camera model')
                            close([width, height], [camera.width, camera.height], 'OpenSfM image dimensions', atol=0, rtol=0)
                            f = original_camera['focal'] * max(width, height)
                            close([f, width / 2, height / 2, original_camera.get('k1', 0), original_camera.get('k2', 0)], camera.params, 'OpenSfM calibration')
                        verify_opensfm_points(source, model, result)
                        structure_checked = True
                    elif isinstance(source, dict) and 'views' in source and 'extrinsics' in source:
                        views = {item['value']['ptr_wrapper']['data']['filename']: item['value']['ptr_wrapper']['data'] for item in source['views']}
                        poses = {item['key']: item['value'] for item in source['extrinsics']}
                        intrinsics = {item['key']: item['value']['ptr_wrapper']['data'] for item in source['intrinsics']}
                        if len(poses) != len(images): raise ValueError('OpenMVG posed-view count differs')
                        for _, image in images:
                            view = views[Path(image.name).name]; original_pose = poses[view['id_pose']]; intrinsic = intrinsics[view['id_intrinsic']]
                            pose(image, np.asarray(original_pose['rotation']), np.asarray(original_pose['center']), result)
                            camera = model.cameras[image.camera_id]; focal = intrinsic['focal_length']; cx, cy = intrinsic['principal_point']
                            if camera.model.name != 'FULL_OPENCV': raise ValueError('Unexpected OpenMVG camera model')
                            close([intrinsic['width'], intrinsic['height']], [camera.width, camera.height], 'OpenMVG image dimensions', atol=0, rtol=0)
                            radial = intrinsic.get('disto_k3', [0, 0, 0])
                            close([focal, focal, cx, cy, radial[0], radial[1], 0, 0, radial[2], 0, 0, 0], camera.params, 'OpenMVG calibration')
                        verify_openmvg_structure(source, model, result)
                        structure_checked = True
                    else:
                        raise ValueError('Source schema needs an independent verifier')
                if model.num_points3D() and not structure_checked:
                    raise ValueError('Nonempty camera-adapter exports require independent source point checks')
                result.update(status='passed', counts={'cameras': model.num_cameras(), 'images': model.num_reg_images(), 'points': model.num_points3D()},
                              sourceSha256=scene['sourceReceipt']['sha256'], exportSha256=scene['exportSha256'])
        except Exception as error:
            result['error'] = str(error)
        results.append(result)
        print(json.dumps(result), flush=True)
    output.write_text(json.dumps(results, indent=2), encoding='utf8')
    return results

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', type=Path, required=True, help='Local browser reports, source bytes, reference photo headers and exported ZIPs')
    parser.add_argument('--frame-coverage', type=Path, help='Optional exact scene-ID to complete RGB-folder inventory receipts')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    root = args.dir.resolve()
    coverage = json.loads(args.frame_coverage.read_bytes()) if args.frame_coverage else {}
    results = verify_scene_exports(root, args.output or root / 'independent-model-results.json', coverage)
    if not results or any(item['status'] != 'passed' for item in results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
