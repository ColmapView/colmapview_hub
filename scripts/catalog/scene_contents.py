"""Validate pinned content inventories and copy immutable, licensed previews."""

import hashlib
import re
from copy import deepcopy
from pathlib import PurePosixPath

from .scene_qualification import scene_key


DATA_KINDS = {'images', 'cameras', 'point_cloud', 'splats', 'masks', 'meshes', 'geometry'}
CONTENT_KINDS = DATA_KINDS - {'images', 'cameras'}
PHOTO_STATES = {'complete_export_checked', 'sample_checked', 'partial', 'path_policy_required', 'companion_archive'}
PHOTO_LICENSES = {'pd', 'cc0', 'cc0-1.0', 'cc-by-2.0', 'cc-by-2.5', 'cc-by-3.0', 'cc-by-4.0',
                 'cc-by-sa-2.0', 'cc-by-sa-2.5', 'cc-by-sa-3.0', 'cc-by-sa-4.0',
                 'cc-by-sa-3.0-pl', 'cc-by-sa-3.0-ro', 'cc-by-sa-3.0-es', 'cc-by-3.0-us', 'cc-by-2.5-hu'}


def source_path(value):
    return (isinstance(value, str) and bool(value) and not value.startswith('/') and '\\' not in value
            and all(part not in ('', '.', '..') for part in value.split('/')))


def is_metadata_sidecar(value):
    return isinstance(value, str) and any(part.startswith('._') or part.casefold() in ('__macosx', '.ds_store')
                                          for part in value.split('/'))


def content_scene_reviews(catalog, policy, root):
    if (policy.get('schemaVersion') != 1 or policy.get('coverage') != 'all_published_scenes'
            or not isinstance(policy.get('sources'), list) or not policy.get('checkedAt')):
        raise ValueError('Invalid scene content evidence')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for source in policy['sources']:
        parent = parents.get(source['sourceId'])
        revision = next((fact['value'] for fact in (parent or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if not parent or revision != source.get('revision'):
            raise ValueError('Content evidence revision changed; recheck the source')
        for scene in source['scenes']:
            if not isinstance(scene.get('data'), dict) or not isinstance(scene.get('files'), (dict, type(None))):
                raise ValueError('Content evidence needs exact model files and content roles')
            for kind, evidence in scene['data'].items():
                if (kind not in CONTENT_KINDS or not isinstance(evidence, dict)
                        or evidence.get('status') not in ('listed', 'header_checked')
                        or not source_path(evidence.get('samplePath')) or is_metadata_sidecar(evidence.get('samplePath'))
                        or ('count' in evidence and (type(evidence['count']) is not int or evidence['count'] < 1))):
                    raise ValueError('Invalid content role evidence')
                if kind in ('point_cloud', 'meshes') and evidence['status'] != 'header_checked':
                    raise ValueError('Specific PLY contents require header evidence')
                if kind == 'splats' and PurePosixPath(evidence['samplePath']).suffix.lower() == '.ply' and evidence['status'] != 'header_checked':
                    raise ValueError('A PLY extension does not establish Gaussian splats')
            thumbnail = scene.get('thumbnail')
            if thumbnail:
                if (parent.get('licenseCategory') != 'commercial' or parent['license'] != thumbnail.get('datasetLicense')
                        or thumbnail.get('license') != parent['license'] and thumbnail.get('license') not in PHOTO_LICENSES
                        or not re.fullmatch(r'[a-f0-9]{64}\.jpg', thumbnail.get('file', ''))
                        or thumbnail.get('width') != 320 or thumbnail.get('height') != 320
                        or thumbnail.get('crop') != 'center_square' or not thumbnail.get('attribution')
                        or not re.fullmatch('[a-f0-9]{64}', thumbnail.get('sourceSha256', ''))
                        or not source_path(thumbnail.get('sourcePath'))
                        or (thumbnail.get('sourceArchive') and not source_path(thumbnail['sourceArchive']))):
                    raise ValueError('Preview requires an attributed commercial-license photo and fixed square crop')
                file = root / 'data/scene-thumbnails' / thumbnail['file']
                if file.is_symlink():
                    raise ValueError('Preview must be a regular built asset')
                body = file.read_bytes()
                if not 0 < len(body) <= 65536 or not body.startswith(b'\xff\xd8\xff') or hashlib.sha256(body).hexdigest() + '.jpg' != thumbnail['file']:
                    raise ValueError('Preview bytes changed; regenerate the crop')
            key = scene_key(source['sourceId'], scene['kind'], scene['path'], scene.get('archive'))
            if key in reviews:
                raise ValueError('Duplicate scene content evidence')
            reviews[key] = {**scene, 'revision': revision}
    return reviews


def apply_content_evidence(entry, row, revision, proof, review):
    if revision != review['revision'] or row[2] != review['files']:
        raise ValueError('Content evidence model files changed; recheck the scene')
    result = deepcopy(proof)
    native = proof.get('sceneCompatibility') or proof.get('sceneValidation') or {}
    data = {'cameras': {'status': 'checked'}}
    if native.get('cameras'):
        data['cameras']['count'] = native['cameras']
    points = native.get('points')
    if isinstance(points, int) and points > 0:
        data['point_cloud'] = {'status': 'checked', 'count': points}
    elif points is None and any(role.lower() == 'points3d' for role in (row[2] or {})):
        data['point_cloud'] = {'status': 'listed'}
    state = proof.get('photoAvailability')
    if state in PHOTO_STATES:
        status = {'path_policy_required': 'needs_setup', 'companion_archive': 'archive', 'partial': 'partial'}.get(state, 'checked')
        data['images'] = {'status': status}
        if state == 'complete_export_checked':
            data['images']['count'] = proof['sceneValidation']['photoCount']
    for kind, evidence in review['data'].items():
        if kind not in data or data[kind]['status'] != 'checked':
            data[kind] = {**deepcopy(evidence), 'status': 'checked' if evidence['status'] == 'header_checked' else 'listed'}
    result['availableData'] = data
    return apply_thumbnail_evidence(entry, result, review.get('thumbnail'))


def apply_thumbnail_evidence(entry, proof, thumbnail):
    """Reuse only a validated crop of this scene's exact, checked photograph."""
    result = deepcopy(proof)
    state = proof.get('photoAvailability')
    if thumbnail:
        audit = proof.get('photoAudit') or {}
        if state not in PHOTO_STATES or entry.get('licenseCategory') != 'commercial' or entry['license'] != thumbnail['datasetLicense']:
            raise ValueError('Preview conflicts with scene photo or license evidence')
        if thumbnail.get('sourceArchive'):
            if thumbnail['sourceArchive'] != (audit.get('archive') or {}).get('path'):
                raise ValueError('Preview archive does not match this scene')
        elif thumbnail['sourcePath'] != audit.get('samplePath'):
            raise ValueError('Preview photograph does not match this scene')
        result['thumbnail'] = {**deepcopy(thumbnail), 'url': '/hub/datasets/individual/thumbnails/' + thumbnail['file']}
        result['thumbnail'].pop('file')
    return result
