"""Pinned photo availability is evidence, never a model-compatibility gate."""

from copy import deepcopy
import re
from .scene_qualification import scene_key
from .scene_contents import is_metadata_sidecar, source_path
from .photo_sources import source_photo_url, validate_photo_source


PHOTO_STATES = {'sample_checked', 'partial', 'not_included', 'not_found',
                'path_policy_required', 'companion_archive', 'review_required', 'not_checked'}
SAMPLE_STATES = {'sample_checked', 'partial', 'path_policy_required'}


def photo_scene_reviews(catalog, policy):
    if (policy.get('schemaVersion') != 1 or not isinstance(policy.get('sources'), list)
            or policy.get('coverage') not in ('all_published_scenes', 'reviewed_scenes')):
        raise ValueError('Invalid scene photo evidence')
    parents = {entry['sourceId']: entry for entry in catalog['entries']}
    reviews = {}
    for source in policy['sources']:
        parent = parents.get(source['sourceId'])
        revision = next((fact['value'] for fact in (parent or {}).get('facts', []) if fact['label'] == 'Pinned revision'), None)
        if not parent or revision != source.get('revision'):
            raise ValueError(f'Photo evidence revision changed; recheck {source["sourceId"]}')
        for scene in source['scenes']:
            audit = scene['audit']
            status = audit.get('status')
            pending_inventory = (status == 'not_checked' and audit.get('listingComplete') is False
                                 and audit.get('policy') == 'photo_inventory_pending' and not audit.get('samplePath'))
            exact_sample = (status in SAMPLE_STATES and audit.get('policy') == 'exact_registered_sample'
                            and isinstance(audit.get('sampleRegisteredName'), str) and bool(audit['sampleRegisteredName'])
                            and re.fullmatch('[a-f0-9]{64}', audit.get('samplePrefixSha256', '')) is not None
                            and (audit.get('sampleDimensionsMatch') is True
                                 or status == 'path_policy_required' and audit.get('sampleDimensionsMatch') is False))
            if (status not in PHOTO_STATES or not audit.get('summary') or not audit.get('checkedAt')
                    or not audit.get('policy') or not scene.get('files')
                    or audit.get('listingComplete') is not True and not pending_inventory and not exact_sample):
                raise ValueError('Photo evidence requires a complete pinned inventory, scope and status')
            if any(not isinstance(audit.get(field, ''), str) for field in
                   ('summary', 'checkedAt', 'policy', 'sceneRoot', 'policyNote', 'mediaScope', 'photoCollection', 'mappingFile', 'associationFile', 'samplePath')):
                raise ValueError('Photo descriptions and source paths must be strings')
            unmapped = audit.get('unmappedMedia')
            if unmapped is not None:
                paths = unmapped.get('paths') if isinstance(unmapped, dict) else None
                kind = unmapped.get('kind') if isinstance(unmapped, dict) else None
                suffixes = ('.mp4', '.mov', '.mkv', '.avi', '.webm', '.vrs') if kind == 'video' else ('.zip', '.tar', '.tar.gz', '.tgz')
                if (status != 'review_required' or kind not in ('video', 'archive')
                        or not isinstance(paths, list) or not paths
                        or any(not source_path(path) or is_metadata_sidecar(path)
                               or not path.lower().endswith(suffixes) for path in paths)
                        or len(paths) != len(set(paths))
                        or not isinstance(unmapped.get('inventorySha256'), str)
                        or re.fullmatch('[a-f0-9]{64}', unmapped['inventorySha256']) is None):
                    raise ValueError('Unmapped imagery requires scoped media paths, inventory evidence and a mapping-review status')
            if status in SAMPLE_STATES and (not audit.get('samplePath') or audit.get('sampleBrowserRead') is not True
                                           or audit.get('samplePixels') not in ('decoded', 'deferred')):
                raise ValueError('Found photographs require a matching browser-readable sample')
            external = audit.get('photoSource')
            if external is not None:
                validate_photo_source(external)
                if (external['sourceId'] == source['sourceId'] or status not in SAMPLE_STATES
                        or audit.get('samplePixels') != 'decoded' or audit.get('sampleDimensionsMatch') is not True):
                    raise ValueError('External photos need a decoded, calibrated sample from a different source')
                source_photo_url(external, audit.get('samplePath'))
            preview = audit.get('previewPolicy')
            if preview is not None and (not isinstance(preview, dict) or preview.get('status') != 'not_permitted'
                    or not isinstance(preview.get('reason'), str) or not preview['reason'].strip()
                    or not isinstance(preview.get('termsUrl'), str) or not preview['termsUrl'].startswith('https://')
                    or re.fullmatch('[a-f0-9]{64}', preview.get('sha256', '')) is None):
                raise ValueError('A preview restriction needs the publisher terms and their receipt')
            calibration = audit.get('sampleCalibration')
            if calibration is not None:
                archive_sample = (audit.get('archive') or {}).get('sample') or {}
                sample_read = (audit.get('samplePath') and audit.get('sampleBrowserRead') is True
                               or status == 'companion_archive' and archive_sample.get('path')
                               and archive_sample.get('pixels') == 'decoded' and audit['archive'].get('browserRangeRead') is True)
                if (not isinstance(calibration, dict)
                        or any(type(value) is not int or value < 1 for value in
                               (calibration.get('width'), calibration.get('height'), audit.get('sampleWidth'), audit.get('sampleHeight')))
                        or not re.fullmatch('[a-f0-9]{64}', calibration.get('sha256', ''))
                        or not sample_read
                        or type(audit.get('sampleDimensionsMatch')) is not bool
                        or audit['sampleDimensionsMatch'] != (calibration['width'] == audit['sampleWidth']
                                                             and calibration['height'] == audit['sampleHeight'])
                        or archive_sample and archive_sample.get('dimensionsMatch') != audit['sampleDimensionsMatch']):
                    raise ValueError('Photo resolution evidence must match its dimensions and exact camera file digest')
            for field in ('nameCheck', 'proposedNameCheck', 'mappingCheck'):
                check = audit.get(field)
                if not check:
                    continue
                total = check.get('registered' if field != 'mappingCheck' else 'entries')
                matched = check.get('matched')
                if (type(total) is not int or type(matched) is not int or not 0 <= matched <= total
                        or total < 1):
                    raise ValueError('Invalid photo coverage counts')
                if field == 'nameCheck' and any(type(check.get(key, 0)) is not int or not 0 <= check.get(key, 0) <= total
                                                for key in ('missing', 'ambiguous')):
                    raise ValueError('Invalid photo diagnostic counts')
                if 'scope' in check or 'totalRegistered' in check:
                    if (field != 'nameCheck' or check.get('scope') != 'prefix'
                            or type(check.get('totalRegistered')) is not int or check['totalRegistered'] < total):
                        raise ValueError('Sampled photo names require explicit prefix and total registered counts')
            if status == 'companion_archive':
                archive = audit.get('archive') or {}
                archive_format = archive.get('format', 'zip')
                if (not source_path(archive.get('path')) or is_metadata_sidecar(archive['path'])
                        or archive_format not in ('zip', 'tar') or not archive['path'].lower().endswith('.' + archive_format)
                        or type(archive.get('photos')) is not int or archive['photos'] < 1
                        or archive.get('nameSampleMatched') is not True or archive.get('browserRangeRead') is not True):
                    raise ValueError('Companion image evidence requires an indexed archive and browser range check')
                if archive_format == 'tar':
                    sample = archive.get('sample') or {}
                    start, data_start, size, total = (sample.get('headerOffset'), sample.get('dataOffset'),
                                                     sample.get('bytes'), archive.get('bytes'))
                    if (any(type(value) is not int for value in (start, data_start, size, total))
                            or start < 0 or start % 512 or data_start % 512
                            or not 512 <= data_start - start <= 1024 * 1024
                            or not 0 < size <= 64 * 1024 * 1024 or data_start + size > total
                            or type(archive.get('inventoryComplete')) is not bool
                            or not source_path(sample.get('path')) or is_metadata_sidecar(sample['path'])
                            or not isinstance(sample.get('registeredName'), str) or not sample['registeredName']
                            or re.fullmatch('[a-f0-9]{64}', sample.get('sha256', '')) is None
                            or sample.get('pixels') != 'decoded' or type(sample.get('dimensionsMatch')) is not bool):
                        raise ValueError('TAR photos require exact sampled member bounds, bytes and decoded pixels')
                    prefix = archive.get('indexBytes')
                    if prefix is not None and (type(prefix) is not int or prefix % 512
                            or not data_start + size <= prefix <= total or archive.get('prefixComplete') is not True):
                        raise ValueError('TAR photo prefix must be complete and contain its checked sample')
            key = scene_key(source['sourceId'], scene['kind'], scene['path'], scene.get('archive'))
            if key in reviews:
                raise ValueError('Duplicate scene photo evidence')
            reviews[key] = {**scene, 'revision': revision}
    return reviews


def apply_photo_evidence(entry, row, revision, proof, review):
    if revision != review['revision'] or dict(row[2] or {}) != review['files']:
        raise ValueError('Photo evidence model files changed; recheck the scene')
    result = deepcopy(proof)
    audit = deepcopy(review['audit'])
    if result.get('photoAvailability') == 'complete_export_checked':
        if audit['status'] not in ('sample_checked',) or audit.get('sampleDimensionsMatch') is False:
            raise ValueError('Photo evidence conflicts with a complete original-photo export')
    else:
        result['photoAvailability'] = audit['status']
        if result.get('level') == 'native_layout_checked':
            result['summary'] = ('Native camera and registered pose headers checked; no native point file is supplied. ' if row[0] == 'cameras'
                                 else 'Native camera, registered pose and point-file headers checked. ') + audit['summary']
    if (((entry.get('verification') or {}).get('sourceImages') or {}).get('status') == 'not_included'
            and audit['status'] != 'not_included' and not audit.get('photoSource')):
        raise ValueError('Photo evidence conflicts with the publisher RGB exclusion')
    result['photoAudit'] = audit
    return result
