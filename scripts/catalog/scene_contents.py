"""Validate pinned content inventories and copy immutable, attributed previews."""

import hashlib
import re
from copy import deepcopy
from pathlib import PurePosixPath
from urllib.parse import urlsplit

from .scene_qualification import scene_key


DATA_KINDS = {'images', 'cameras', 'point_cloud', 'splats', 'masks', 'meshes', 'geometry'}
CONTENT_KINDS = DATA_KINDS - {'images', 'cameras'}
PHOTO_STATES = {'complete_export_checked', 'sample_checked', 'partial', 'path_policy_required', 'companion_archive'}


def source_path(value):
    return (isinstance(value, str) and bool(value) and not value.startswith('/') and '\\' not in value
            and all(part not in ('', '.', '..') for part in value.split('/')))


def is_metadata_sidecar(value):
    return isinstance(value, str) and any(part.startswith('._') or part.casefold() in ('__macosx', '.ds_store')
                                          for part in value.split('/'))


def photo_source_path(value, entry):
    if source_path(value):
        return True
    if not isinstance(value, str) or entry.get('provider') != 'public':
        return False
    url = urlsplit(value)
    return url.scheme == 'https' and bool(url.hostname) and not (url.username or url.password or url.fragment)


def valid_preview_geometry(thumbnail):
    width, height = thumbnail.get('width'), thumbnail.get('height')
    if thumbnail.get('crop') == 'center_square':
        return width == height == 320
    source_width, source_height = thumbnail.get('originalWidth'), thumbnail.get('originalHeight')
    return (thumbnail.get('crop') == 'aspect_fit'
            and all(type(value) is int and value > 0 for value in (width, height, source_width, source_height))
            and max(width, height) == 320
            and abs(width * source_height - height * source_width) <= max(source_width, source_height) / 2)


def valid_video_preview(thumbnail):
    frame = thumbnail.get('videoFrame')
    if not isinstance(frame, dict) or not re.fullmatch(r'[a-f0-9]{64}', str(frame.get('receiptSha256', ''))):
        return False
    selection = set(frame) - {'receiptSha256'}
    return (bool(thumbnail.get('registeredName')) and not thumbnail.get('sourceArchive')
            and (selection == {'frameIndex'} and type(frame['frameIndex']) is int and 0 <= frame['frameIndex'] < 2**53
                 or selection == {'timestamp'} and type(frame['timestamp']) in (int, float)
                 and 0 <= frame['timestamp'] < float('inf')))


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
                member = evidence.get('archiveMember')
                archive_format = evidence.get('archiveFormat')
                if member is not None or archive_format is not None:
                    if (not source_path(member) or is_metadata_sidecar(member) or archive_format not in ('zip', 'tar.zst')
                            or not evidence['samplePath'].lower().endswith('.' + archive_format)):
                        raise ValueError('Archived content needs an exact safe member and container format')
                if kind == 'splats' and PurePosixPath(member or evidence['samplePath']).suffix.lower() == '.ply' and evidence['status'] != 'header_checked':
                    raise ValueError('A PLY extension does not establish Gaussian splats')
                if 'encoding' in evidence or 'requiresConversion' in evidence:
                    if (kind != 'splats' or evidence.get('encoding') != 'compressed_ply'
                            or evidence.get('requiresConversion') is not True or evidence['status'] != 'header_checked'
                            or not evidence['samplePath'].lower().endswith('.ply') or member is not None):
                        raise ValueError('Compressed splats require checked encoding and explicit conversion')
            thumbnail = scene.get('thumbnail')
            if thumbnail:
                if (parent['license'] != thumbnail.get('datasetLicense')
                        or not isinstance(thumbnail.get('license'), str) or not thumbnail['license'].strip()
                        or not re.fullmatch(r'[a-f0-9]{64}\.jpg', thumbnail.get('file', ''))
                        or not valid_preview_geometry(thumbnail) or not thumbnail.get('attribution')
                        or not re.fullmatch('[a-f0-9]{64}', thumbnail.get('sourceSha256', ''))
                        or not photo_source_path(thumbnail.get('sourcePath'), parent)
                        or ('videoFrame' in thumbnail and not valid_video_preview(thumbnail))
                        or is_metadata_sidecar(thumbnail.get('sourcePath'))
                        or (thumbnail.get('sourceArchive') and not source_path(thumbnail['sourceArchive']))):
                    raise ValueError('Preview requires attributed source provenance and checked thumbnail geometry')
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
            status = ('archive' if evidence.get('archiveMember') else 'needs_setup' if evidence.get('requiresConversion')
                      else 'checked' if evidence['status'] == 'header_checked' else 'listed')
            data[kind] = {**deepcopy(evidence), 'status': status}
    result['availableData'] = data
    thumbnail = review.get('thumbnail')
    # Video receipts are attached after native model and photograph policies.
    return result if thumbnail and 'videoFrame' in thumbnail else apply_thumbnail_evidence(entry, result, thumbnail)


def apply_thumbnail_evidence(entry, proof, thumbnail, video_review=None):
    """Reuse only this scene's checked photograph or exact reviewed video sample."""
    result = deepcopy(proof)
    state = proof.get('photoAvailability')
    if thumbnail:
        audit = proof.get('photoAudit') or {}
        video = thumbnail.get('videoFrame')
        if (state not in (PHOTO_STATES | {'video_frames'} if video else PHOTO_STATES)
                or entry['license'] != thumbnail['datasetLicense']):
            raise ValueError('Preview conflicts with scene photo or license evidence')
        if video:
            route = proof.get('videoFrameRouting') or proof.get('videoFrameMapping') or {}
            if (not valid_video_preview(thumbnail) or not video_review
                    or route.get('receiptSha256') != video_review['receiptSha256']
                    or video['receiptSha256'] != video_review['receiptSha256']):
                raise ValueError('Video preview needs its current reviewed media receipt')
            samples = video_review.get('samples', [video_review.get('sample')])
            sample = next((item for item in samples if item and item['name'] == thumbnail['registeredName']), None)
            if not sample:
                raise ValueError('Video preview is not a checked registered sample')
            if 'bindings' in video_review:
                binding = next(item for item in video_review['bindings'] if item['name'] == sample['name'])
                source = next(item for item in video_review['videos'] if item['id'] == binding['video'])
                selection = {key: binding[key] for key in ('frameIndex', 'timestamp') if key in binding}
                source_hash = source['sha256']
            else:
                source = next(item for item in video_review['videos'] if item['name'] == sample['name'])
                selection = {'timestamp': video_review['timestamp']}
                source_hash = source['sourceSha256']
            if (video != {'receiptSha256': video_review['receiptSha256'], **selection}
                    or thumbnail['sourcePath'] != source['sourcePath'] or thumbnail['sourceSha256'] != source_hash
                    or thumbnail.get('originalWidth') != sample['width'] or thumbnail.get('originalHeight') != sample['height']):
                raise ValueError('Video preview does not match the selected source frame')
        elif thumbnail.get('sourceArchive'):
            archive = audit.get('archive') or {}
            if thumbnail['sourceArchive'] != archive.get('path'):
                raise ValueError('Preview archive does not match this scene')
            if archive.get('format') == 'tar' and (thumbnail['sourcePath'] != archive['sample']['path']
                                                 or thumbnail['sourceSha256'] != archive['sample']['sha256']):
                raise ValueError('Preview TAR photograph does not match the reviewed member')
        elif thumbnail['sourcePath'] != audit.get('samplePath'):
            raise ValueError('Preview photograph does not match this scene')
        result['thumbnail'] = {**deepcopy(thumbnail), 'url': '/hub/datasets/individual/thumbnails/' + thumbnail['file']}
        result['thumbnail'].pop('file')
    return result
