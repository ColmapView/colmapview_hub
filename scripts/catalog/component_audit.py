"""Conservative findings for missing scene components, independent of loading."""

from .scene_contents import DATA_KINDS


def missing_component_findings(missing, available, *, source_readable, scope_complete,
                               photo_candidates=False, unclassified_assets=False,
                               uninspected_containers=False, association_candidates=False):
    """A scoped listing can establish non-listing, never global non-existence.

    Callers retain the pinned source, exact model identity and scope receipts.
    Positive presence is independent of automatic attachment or full export.
    """
    if not set(missing) <= DATA_KINDS or not set(available) <= DATA_KINDS:
        raise ValueError('Unknown scene data role')
    findings = {}
    for role in sorted(missing):
        if role in available:
            findings[role] = 'recovered'
        elif role == 'geometry' and {'point_cloud', 'splats', 'meshes'} & set(available):
            findings[role] = 'specific_geometry_already_present'
        elif not source_readable:
            findings[role] = 'source_inaccessible'
        elif role == 'images' and photo_candidates:
            findings[role] = 'photo_association_review'
        elif role in ('point_cloud', 'splats', 'meshes', 'geometry') and unclassified_assets:
            findings[role] = 'asset_header_review'
        elif uninspected_containers:
            findings[role] = 'container_review'
        elif association_candidates:
            findings[role] = 'scene_association_review'
        elif not scope_complete:
            findings[role] = 'inventory_incomplete'
        else:
            findings[role] = 'not_listed_in_checked_scope'
    return findings


def write_audit_csv(report, target):
    """Export the dated operator snapshot; it is not a live load guarantee."""
    import csv
    import json
    fields = ['sceneId', 'sourceId', 'revision', 'scenePath', 'publication', 'component', 'finding',
              'checkedScope', 'scopeComplete', 'candidates', 'evidence', 'hubUrl']
    with target.open('w', encoding='utf-8-sig', newline='') as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for scene in report['scenes']:
            source = report['sources'][scene['source']]
            for component, finding in scene['findings'].items():
                writer.writerow({'sceneId': scene['id'], 'sourceId': source['sourceId'], 'revision': source['revision'],
                    'scenePath': scene['path'], 'publication': scene['publication'], 'component': component, 'finding': finding,
                    'checkedScope': scene['scope'], 'scopeComplete': scene['scopeComplete'],
                    'candidates': json.dumps({key: {'count': len(value), 'examples': value[:3]} if isinstance(value, list) else value
                                              for key, value in scene['candidates'].items()}, separators=(',', ':')),
                    'evidence': json.dumps(scene.get('recovered', {}).get(component, {}), separators=(',', ':')),
                    'hubUrl': 'https://colmapview.opsiclear.com/hub/datasets/entry/' + scene['id']})


if __name__ == '__main__':
    import argparse
    import gzip
    import json
    from pathlib import Path
    parser = argparse.ArgumentParser(description='Export the dated, offline component audit snapshot.')
    parser.add_argument('--report', type=Path, default=Path('data/scene-component-audit.json.gz'))
    parser.add_argument('--output', type=Path, default=Path('public/hub/datasets/individual/component-audit.csv'))
    args = parser.parse_args()
    report = json.loads(gzip.decompress(args.report.read_bytes()))
    if report.get('schemaVersion') != 1 or not report.get('checkedAt'):
        raise ValueError('Invalid component audit snapshot')
    write_audit_csv(report, args.output)
    args.output.with_suffix('.json.gz').write_bytes(args.report.read_bytes())
