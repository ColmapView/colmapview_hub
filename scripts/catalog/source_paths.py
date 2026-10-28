"""Safe source-relative paths shared by offline catalog evidence."""


def source_path(value):
    return (isinstance(value, str) and bool(value) and not value.startswith('/') and '\\' not in value
            and all(part not in ('', '.', '..') for part in value.split('/')))
