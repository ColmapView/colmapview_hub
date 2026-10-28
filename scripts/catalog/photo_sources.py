"""Exact external photo identities used only by reviewed offline catalog inputs."""

import re
from urllib.parse import quote
from .source_paths import source_path


def source_photo_url(source, path):
    if (not source_path(path) or re.search(r'[?#\x00-\x1f]', path)
            or not path.startswith(source['scope'] + '/')):
        raise ValueError('Photograph is outside its reviewed source scope')
    return ('https://huggingface.co/datasets/' + quote(source['sourceId'][3:], safe='/')
            + '/resolve/' + source['revision'] + '/' + quote(path, safe='/'))


def validate_photo_source(source):
    if (not isinstance(source, dict)
            or any(not isinstance(source.get(key), str) for key in ('sourceId', 'revision', 'inventorySha256'))
            or re.fullmatch(r'hf:[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*', source.get('sourceId', '')) is None
            or re.fullmatch('[a-f0-9]{40}', source.get('revision', '')) is None
            or re.fullmatch('[a-f0-9]{64}', source.get('inventorySha256', '')) is None
            or not source_path(source.get('scope'))
            or any(not isinstance(source.get(key), str) or not source[key].strip() for key in ('license', 'attribution'))):
        raise ValueError('External photos require a pinned public source, inventory, scope and attribution')
    return source
