"""Independent OpenSfM sidecar-to-COLMAP observation and reprojection checks."""
from collections import defaultdict
import numpy as np


def verify_tracks(source, model, text, point_ids):
    lines = text.lstrip('\ufeff').splitlines()
    version = 0
    if lines and lines[0].startswith('OPENSFM_TRACKS_VERSION'):
        header = lines.pop(0)
        if header not in ('OPENSFM_TRACKS_VERSION_v0', 'OPENSFM_TRACKS_VERSION_v1', 'OPENSFM_TRACKS_VERSION_v2'):
            raise ValueError('Unknown OpenSfM track version')
        version = int(header[-1])
    images = {image.name: image for image in model.images.values()}
    features = defaultdict(dict)
    tracks = defaultdict(set)
    for line in lines:
        if not line.strip():
            continue
        fields = line.split('\t')
        if len(fields) != (8, 9, 11)[version] or not all(fields[:2]) or not np.isfinite([float(v) for v in fields[2:]]).all():
            raise ValueError('Malformed source track observation')
        name, track = fields[:2]
        if name not in images:
            continue
        feature = int(fields[2])
        if feature < 0 or str(feature) != fields[2] or feature in features[name] or track in tracks[name]:
            raise ValueError('Conflicting source feature or track')
        features[name][feature] = (track, float(fields[3]), float(fields[4]))
        tracks[name].add(track)
    expected_tracks = defaultdict(list)
    errors = defaultdict(list)
    observations = untriangulated = 0
    for name, image in images.items():
        rows = sorted(features[name].items())
        if len(rows) != len(image.points2D):
            raise ValueError('Exported feature count differs from source tracks')
        camera = model.cameras[image.camera_id]
        for index, (_, (track, x, y)) in enumerate(rows):
            original = np.array([x * max(camera.width, camera.height) + camera.width / 2,
                                 y * max(camera.width, camera.height) + camera.height / 2])
            actual = image.points2D[index]
            if not (np.array_equal(original, actual.xy) or np.array_equal(original.astype('f4').astype(float), actual.xy)):
                raise ValueError('OpenSfM normalized observation differs at the COLMAP pixel center')
            point_id = point_ids.get(track)
            if point_id is None:
                if actual.has_point3D():
                    raise ValueError('Untriangulated source feature acquired a false 3D match')
                untriangulated += 1
                continue
            if actual.point3D_id != point_id:
                raise ValueError('OpenSfM point reference differs')
            expected_tracks[point_id].append((image.image_id, index))
            xyz = np.asarray(source['points'][track]['coordinates'])
            camera_point = image.cam_from_world() * xyz
            projected = camera.img_from_cam(camera_point) if camera_point[2] > 0 else None
            if projected is not None and np.isfinite(projected).all():
                errors[point_id].append(float(np.linalg.norm(projected - original)))
            observations += 1
    for point_id, point in model.points3D.items():
        exported = [(entry.image_id, entry.point2D_idx) for entry in point.track.elements]
        if sorted(exported) != sorted(expected_tracks[point_id]):
            raise ValueError('OpenSfM reciprocal tracks differ')
        expected = float(np.mean(errors[point_id])) if errors[point_id] else 0.
        if not np.isclose(expected, point.error, atol=1e-8, rtol=np.finfo(np.float32).eps):
            raise ValueError('OpenSfM reprojection error differs from retained source observations')
    return {'pointObservations': observations, 'untriangulatedObservations': untriangulated, 'trackValues': 'passed'}
