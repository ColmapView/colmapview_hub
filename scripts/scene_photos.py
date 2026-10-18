"""Pinned photo availability is evidence, never a model-compatibility gate."""

from copy import deepcopy
from scene_qualification import scene_key


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
            if (status not in PHOTO_STATES or not audit.get('summary') or not audit.get('checkedAt')
                    or not audit.get('policy') or not scene.get('files') or audit.get('listingComplete') is not True):
                raise ValueError('Photo evidence requires a complete pinned inventory, scope and status')
            if any(not isinstance(audit.get(field, ''), str) for field in
                   ('summary', 'checkedAt', 'policy', 'sceneRoot', 'policyNote', 'mediaScope', 'photoCollection', 'mappingFile', 'associationFile', 'samplePath')):
                raise ValueError('Photo descriptions and source paths must be strings')
            if status in SAMPLE_STATES and (not audit.get('samplePath') or audit.get('sampleBrowserRead') is not True
                                           or audit.get('samplePixels') not in ('decoded', 'deferred')):
                raise ValueError('Found photographs require a matching browser-readable sample')
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
            if status == 'companion_archive':
                archive = audit.get('archive') or {}
                if (not archive.get('path') or type(archive.get('photos')) is not int or archive['photos'] < 1
                        or archive.get('nameSampleMatched') is not True or archive.get('browserRangeRead') is not True):
                    raise ValueError('Companion image evidence requires an indexed ZIP and browser range check')
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
        if audit['status'] not in ('sample_checked',):
            raise ValueError('Photo evidence conflicts with a complete original-photo export')
    else:
        result['photoAvailability'] = audit['status']
        if result.get('level') == 'native_layout_checked':
            result['summary'] = 'Native camera, registered pose and point-file headers checked. ' + audit['summary']
    if ((entry.get('verification') or {}).get('sourceImages') or {}).get('status') == 'not_included' and audit['status'] != 'not_included':
        raise ValueError('Photo evidence conflicts with the publisher RGB exclusion')
    result['photoAudit'] = audit
    return result
