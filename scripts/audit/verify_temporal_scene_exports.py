"""Offline source/renderer/COLMAP checks for explicitly selected archive frames.

Requires numpy, plyfile and pycolmap. Source members are complete payloads from
the independent Python TAR/ZIP inspection, not converted browser exports. Whole
archive LFS hashes are publisher declarations; only selected bytes were fetched.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import tarfile
import tempfile
import zipfile

import numpy as np
from plyfile import PlyData
import pycolmap

from .verify_companion_scene_exports import native_camera_model
from .verify_scene_manifest_exports import cached_source, file_hash, source_url


class CapturedRanges(io.RawIOBase):
    """ZIP reader backed only by byte ranges actually fetched by the browser."""
    def __init__(self, responses, root, archive):
        self.position, self.size, self.parts = 0, archive['bytes'], []
        for item in responses:
            if item.get('status') != 206:
                continue
            match = re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)', item.get('contentRange', ''))
            path = root / item['file']
            body = path.read_bytes()
            if (not match or item['url'] != archive['url'] or int(match[3]) != self.size
                    or len(body) != int(match[2]) - int(match[1]) + 1 or len(body) != item['bytes']
                    or file_hash(path) != item['sha256']):
                raise ValueError('Captured browser range differs from its source receipt')
            self.parts.append((int(match[1]), body))
        if not self.parts:
            raise ValueError('Compiled browser receipt contains no original source byte ranges')

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset + (0 if whence == 0 else self.position if whence == 1 else self.size)
        if self.position < 0:
            raise ValueError('Negative source archive seek')
        return self.position

    def read(self, size=-1):
        remaining = max(0, self.size - self.position) if size < 0 else min(size, max(0, self.size - self.position))
        result = []
        while remaining:
            part = next(((start, body) for start, body in self.parts if start <= self.position < start + len(body)), None)
            if part is None:
                raise ValueError('Browser did not fetch the archive bytes required for independent extraction')
            start, body = part
            count = min(remaining, start + len(body) - self.position)
            result.append(body[self.position - start:self.position - start + count])
            self.position += count
            remaining -= count
        return b''.join(result)


def verify_browser_archive(scene, browser, root):
    archive = scene['frameGeometry']['archive']
    member = archive['member']
    reader = CapturedRanges(browser['responses'], root, archive)
    if archive['format'] == 'zip':
        with zipfile.ZipFile(reader) as zipped:
            matches = [item for item in zipped.infolist() if item.filename.removeprefix('./') == member['path']]
            if len(matches) != 1 or matches[0].file_size != member['bytes']:
                raise ValueError('Browser ZIP member identity differs')
            body = zipped.read(matches[0])  # Python validates the complete member CRC.
    else:
        import zstandard
        prefix = reader.read(archive['prefix']['bytes'])
        if hashlib.sha256(prefix).hexdigest() != archive['prefix']['sha256']:
            raise ValueError('Browser compressed prefix differs')
        with zstandard.ZstdDecompressor().stream_reader(io.BytesIO(prefix)) as decoded:
            with tarfile.open(fileobj=decoded, mode='r|') as tar:
                selected = next(item for item in tar if item.isfile())
                if selected.name.removeprefix('./') != member['path'] or selected.size != member['bytes']:
                    raise ValueError('Browser first TAR member differs')
                body = tar.extractfile(selected).read(selected.size)
    if len(body) != member['bytes'] or hashlib.sha256(body).hexdigest() != member['sha256']:
        raise ValueError('Independent extraction from actual browser byte ranges differs from the selected source member')
    return {'method': 'independent_extraction_from_captured_browser_ranges', 'selectedMemberSha256': member['sha256'],
            'rangeResponses': len(reader.parts), 'capturedRangeBytes': sum(len(body) for _, body in reader.parts)}


def verify_source_frame(scene, root):
    frame = scene['frameGeometry']
    archive, member = frame['archive'], frame['archive']['member']
    path = root / 'members' / (member['sha256'] + '.ply')
    if path.stat().st_size != member['bytes'] or file_hash(path) != member['sha256']:
        raise ValueError('Selected original member differs from its complete byte receipt')
    listing = archive['listingReceipt']
    cached = root / 'cache' / (hashlib.sha256(listing['url'].encode()).hexdigest() + '.bin')
    if cached.stat().st_size != listing['bytes'] or file_hash(cached) != listing['sha256']:
        raise ValueError('Pinned archive listing changed')
    published = next(item for item in json.loads(cached.read_bytes()) if item.get('path') == archive['sourcePath'])
    if published['size'] != archive['bytes'] or published['lfs']['oid'] != archive['sha256']:
        raise ValueError('Archive size or publisher LFS identity changed')
    if archive['url'] != source_url(scene, archive['sourcePath']):
        raise ValueError('Archive and camera revision differ')
    data = PlyData.read(path)
    if len(data['vertex']) != frame['count'] or any(element.name != 'vertex' and len(element) for element in data.elements):
        raise ValueError('Selected member count or point-only representation differs')
    xyz = np.column_stack([data['vertex'][key] for key in ('x', 'y', 'z')]).astype(float)
    if not np.isfinite(xyz).all():
        raise ValueError('Source frame contains nonfinite XYZ')
    if frame['role'] == 'splat':
        fields = ('f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3')
        if any(key not in data['vertex'].data.dtype.names or not np.isfinite(data['vertex'][key]).all() for key in fields):
            raise ValueError('Source Gaussian attributes are incomplete or nonfinite')
        declaration = frame['sourceReadme']
        text = cached_source(scene, declaration, root / 'cache').read_text(encoding='utf-8')
        if declaration['statement'] not in text:
            raise ValueError('Publisher world translation statement changed')
        # This audit supports the pinned publisher equation, not inferred offsets.
        if (declaration['statement'] != 'COLMAP position   = released position + (0, +1.5, +1.3)'
                or frame['worldTranslation'] != [0, 1.5, 1.3]):
            raise ValueError('World translation differs from the published equation')
        xyz += np.asarray(frame['worldTranslation'])
    return data['vertex'], xyz


def compare_cameras(original, exported):
    if set(original.cameras) != set(exported.cameras) or set(original.images) != set(exported.images):
        raise ValueError('Camera or image IDs changed')
    max_pose_delta = 0.
    for identity, camera in original.cameras.items():
        actual = exported.cameras[identity]
        if (camera.model != actual.model or camera.width != actual.width or camera.height != actual.height
                or not np.array_equal(camera.params, actual.params)):
            raise ValueError('Camera calibration changed')
    for identity, image in original.images.items():
        actual = exported.images[identity]
        delta = float(np.max(np.abs(image.cam_from_world().matrix() - actual.cam_from_world().matrix())))
        max_pose_delta = max(max_pose_delta, delta)
        if (delta > 1e-12 or image.name != actual.name or image.camera_id != actual.camera_id
                or len(image.points2D) != len(actual.points2D) or actual.num_points3D
                or any(not np.array_equal(a.xy, b.xy) for a, b in zip(image.points2D, actual.points2D))):
            raise ValueError('Camera poses, names or feature coordinates changed')
    return max_pose_delta


def compare_points(path, vertex, count):
    dtype = np.dtype([('id', '<u8'), ('xyz', '<f8', (3,)), ('rgb', 'u1', (3,)), ('error', '<f8'), ('tracks', '<u8')])
    with path.open('rb') as file:
        if int.from_bytes(file.read(8), 'little') != count or path.stat().st_size != 8 + count * dtype.itemsize:
            raise ValueError('Untracked point count or binary framing changed')
    exported = np.memmap(path, dtype=dtype, offset=8, mode='r', shape=(count,))
    try:
        for start in range(0, count, 100000):
            stop = min(start + 100000, count)
            xyz = np.column_stack([vertex[key][start:stop] for key in ('x', 'y', 'z')])
            rgb = np.column_stack([vertex[key][start:stop] for key in ('red', 'green', 'blue')])
            chunk = exported[start:stop]
            if (not np.array_equal(chunk['xyz'], xyz) or not np.array_equal(chunk['rgb'], rgb)
                    or not np.array_equal(chunk['id'], np.arange(start + 1, stop + 1, dtype='<u8'))
                    or chunk['error'].any() or chunk['tracks'].any()):
                raise ValueError('Source XYZ/RGB changed or synthetic tracks were created')
    finally:
        exported._mmap.close()


def verify(scene, browser, root, phase):
    if (not browser or browser.get('status') != 'passed' or browser.get('errors') or browser['counts'] != scene['counts']
            or browser.get('pointDrawCount') != scene['counts']['points']):
        raise ValueError('Matching browser import/render receipt is required')
    frame, counts = scene['frameGeometry'], scene['counts']
    member = frame['archive']['member']
    geometry = browser.get('geometry', {})
    if (geometry.get('sha256') != member['sha256'] or geometry.get('bytes') != member['bytes']
            or geometry.get('role') != frame['role'] or geometry.get('hasImages') is not False):
        raise ValueError('Browser geometry or deliberate photograph absence differs')
    if frame['role'] == 'splat' and (browser.get('gpuCount') != frame['count']
            or geometry.get('splatTransform') != scene['viewerState']['config']['splat']['transform'] or geometry.get('colorMode') != 'splats'):
        raise ValueError('GPU-decoded Gaussian count or camera-world transform differs')
    vertex, xyz = verify_source_frame(scene, root)
    export = root / (phase + '-exports') / (scene['id'] + '.zip')
    if file_hash(export) != browser['exportSha256']:
        raise ValueError('Export differs from its browser receipt')
    result = {'id': scene['id'], 'sourceId': scene['sourceId'], 'revision': scene['revision'], 'status': 'passed', 'counts': counts,
              'sourceSha256': member['sha256'], 'exportSha256': browser['exportSha256'],
              'selectedGeometry': {key: frame[key] for key in ('role', 'frame', 'frameCount', 'count')},
              'archiveSha256Scope': 'publisher_LFS_declaration', 'geometryIntegrity': 'complete_selected_member_sha256',
              'sourceNetworkReads': 0}
    if geometry.get('proofMethod') == 'compiled_loader_integrity_gate_and_captured_source_ranges':
        result['browserArchive'] = verify_browser_archive(scene, browser, root)
    with tempfile.TemporaryDirectory(prefix='temporal-export-', dir=root) as folder:
        directory = Path(folder)
        with zipfile.ZipFile(export) as archive:
            expected = {'sparse/0/' + part + '.bin' for part in ('cameras', 'images', 'points3D')}
            if len(archive.namelist()) != len(expected) or set(archive.namelist()) != expected:
                raise ValueError('Unexpected export paths or invented photographs')
            for part in ('cameras', 'images', 'points3D'):
                (directory / (part + '.bin')).write_bytes(archive.read('sparse/0/' + part + '.bin'))
        model = pycolmap.Reconstruction(str(directory))
        if (model.num_cameras(), model.num_reg_images(), model.num_points3D()) != (counts['cameras'], counts['images'], counts['points']):
            raise ValueError('Complete independent COLMAP read differs')
        original = native_camera_model(scene, scene['modelFiles'], root / 'cache', directory / 'original')
        result['maxSourcePoseDelta'] = compare_cameras(original, model)
        metadata = json.loads(cached_source(scene, frame['sessionManifest'], root / 'cache').read_bytes())
        sequence = metadata['sequences'][frame['sequencePath'].split('/')[-1]]
        if (frame['frame'] not in sequence['frame_ids'] or len(sequence['frame_ids']) != frame['frameCount']
                or {Path(image.name).stem for image in original.images.values()} != set(sequence['cameras'])):
            raise ValueError('Frame membership or registered camera names differ from the source manifest')
        if frame['role'] == 'points3D':
            compare_points(directory / 'points3D.bin', vertex, counts['points'])
            result.update(pointValues='passed', maxPointPositionDelta=0.)
        else:
            result.update(pointValues='passed', splatValues='passed', splatWorldTransform='passed')
        fractions = []
        sample = xyz[::max(1, len(xyz) // 4096)]
        for image in original.images.values():
            camera = original.cameras[image.camera_id]
            pose = image.cam_from_world().matrix()
            camera_xyz = sample @ pose[:, :3].T + pose[:, 3]
            pixels = camera_xyz @ camera.calibration_matrix().T
            pixels = pixels[:, :2] / pixels[:, 2, None]
            fractions.append(float(((camera_xyz[:, 2] > 0) & (pixels[:, 0] >= 0) & (pixels[:, 0] < camera.width)
                                    & (pixels[:, 1] >= 0) & (pixels[:, 1] < camera.height)).mean()))
        # Gaussians include low-opacity/outlier centers outside individual views.
        # The pinned equation establishes the world; projections are a separate
        # majority-view sanity check, not an assumption that every point is in
        # every camera. Retain the worst-view fraction in the receipt.
        if np.median(fractions) < .9 or min(fractions) <= 0:
            raise ValueError('Selected geometry projects outside its source cameras')
        result.update(frameMembership='passed', frameCameraNames='passed', pointReadMethod='pycolmap_full_model',
                      cameraProjection={'minInFrameFraction': min(fractions), 'medianInFrameFraction': float(np.median(fractions))})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--phase', default='browser')
    parser.add_argument('--scene', action='append')
    args = parser.parse_args()
    scenes = json.loads((args.root / 'candidate-reviews.json').read_bytes())
    browser = {row['id']: row for row in json.loads((args.root / (args.phase + '-results.json')).read_bytes())}
    results = [verify(scene, browser.get(scene['id']), args.root, args.phase) for scene in scenes
               if not args.scene or scene['id'] in args.scene]
    (args.root / (args.phase + '-independent.json')).write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'scenes': len(results), 'points': sum(row['counts']['points'] for row in results),
                      'gaussians': sum(row['selectedGeometry']['count'] for row in results if row['selectedGeometry']['role'] == 'splat')}))


if __name__ == '__main__':
    main()
