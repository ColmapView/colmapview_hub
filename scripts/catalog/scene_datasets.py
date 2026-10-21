"""Project a file inventory into named scene datasets without inventing scenes.

Reconstruction sets and camera metadata establish scene boundaries. Loose model
files can be assets of an established scene, but never establish one by themselves.
The original file inventory stays intact for research and future layout checks.
"""

import re
from collections import defaultdict
from pathlib import PurePosixPath

SCENE_KINDS = {'colmap', 'cameras', 'camera-scene', 'splat-scene', 'scene'}
PRIORITY = {'colmap': 0, 'cameras': 1, 'camera-metadata': 2, 'camera-scene': 2, 'splat-scene': 3, 'scene': 4}
MAX_SCENE_FILE_LINKS = 32


def named_variant_groups(rows):
    """Group explicit initialization/refinement pairs after each has qualified.

    Do not infer identity from basenames or cross archive/repository boundaries.
    Other sparse subfolders may be genuinely different captures. Keep every
    original row available for old links; only the browse projection is grouped.
    """
    groups = defaultdict(list)
    for row in rows:
        kind, path, _, archive = row
        match = re.fullmatch(r'(.+)/sparse/(init|refined_aligned)', path)
        if kind in ('colmap', 'cameras') and match:
            groups[(archive, match[1])].append(row)
    result = {}
    for (_, root), variants in groups.items():
        if len(variants) != 2 or {row[1].rsplit('/', 1)[-1] for row in variants} != {'init', 'refined_aligned'}:
            continue
        primary = next(row for row in variants if row[1].endswith('/refined_aligned'))
        for row in variants:
            result[(row[0], row[1], row[3])] = (primary, root, variants)
    return result


def scene_root(kind, path):
    if kind in ('colmap', 'cameras'):
        return re.sub(r'(?:^|/)(?:(?:colmap/)?sparse(?:/\d+)?|known_pose_model|triangulated_model|triangulated_text)$', '', path, flags=re.I)
    if kind == 'camera-metadata':
        return path.rpartition('/')[0]
    return path


def scene_records(rows, details=None, root_aliases=None):
    established = {(row[3], scene_root(row[0], row[1])) for row in rows if row[0] in PRIORITY and row[0] != 'camera-metadata'}
    root_aliases = root_aliases or {}
    # Only a pinned operator audit can equate separately named coordinate
    # variants. Matching scene basenames in unrelated branches is insufficient.
    for alias, target in root_aliases.items():
        origins = [(archive, root) for archive, root in established if root == alias]
        if not origins or alias == target or target in root_aliases or any((archive, target) not in established for archive, _ in origins):
            raise ValueError('Scene root alias must identify an established scene in the same container')
    split_folders = defaultdict(set)
    for kind, path, _, archive in rows:
        root = path.rpartition('/')[0]
        if kind == 'camera-metadata' and PurePosixPath(root).name.lower() in {'train', 'val', 'validation', 'test'}:
            split_folders[(archive, root.rpartition('/')[0])].add(root)
    groups = defaultdict(list)
    loose = []
    for row in rows:
        kind, path, files, archive = row
        if kind in PRIORITY:
            root = root_aliases.get(scene_root(kind, path), scene_root(kind, path))
            parent = root.rpartition('/')[0]
            splits = split_folders.get((archive, parent), set())
            if kind == 'camera-metadata' and root in splits and ((archive, parent) in established
                    or len(splits) > 1 and not any((archive, split) in established for split in splits)):
                root = parent
            groups[(archive, root)].append(row)
        else:
            loose.append(row)
    scenes = []
    inventories = {}
    for (archive, root), anchors in sorted(groups.items(), key=lambda item: (item[0][0] or '', item[0][1])):
        variants = {'triangulated_model': 0, 'triangulated_text': 1, 'known_pose_model': 2}
        anchors.sort(key=lambda row: (PRIORITY[row[0]], scene_root(row[0], row[1]) != root,
                                      variants.get(PurePosixPath(row[1]).name.lower(), 0), row[1]))
        primary = anchors[0]
        kind = 'camera-scene' if primary[0] == 'camera-metadata' else primary[0]
        path = root if kind == 'camera-scene' else primary[1]
        files = {}
        inventory = set()
        def add(role, value):
            inventory.add(value)
            if value not in files.values() and len(files) < MAX_SCENE_FILE_LINKS:
                files[role] = value
        for role, value in sorted((primary[2] or {}).items(), key=lambda pair: pair[0] not in ('cameras', 'images', 'points3d', 'points3D')):
            add(role, value)
        for anchor in anchors:
            if anchor[0] == 'camera-metadata':
                add('metadata:' + anchor[1], anchor[1])
            elif anchor is not primary:
                for role, value in (anchor[2] or {}).items():
                    add(role if anchor[0] == 'splat-scene' and role.startswith('asset:') else 'variant:' + anchor[1] + ':' + role, value)
        scenes.append(([kind, path, files or None, archive], root))
        inventories[(archive, root)] = inventory
    owners = {(row[3], root): row for row, root in scenes if row[0] != 'scene'}
    for archive, root in established:
        target = root_aliases.get(root)
        if target and (archive, target) in owners:
            owners[(archive, root)] = owners[(archive, target)]
            inventories[(archive, root)] = inventories[(archive, target)]
    for kind, path, _, archive in loose:
        # Prefer the most specific established scene. Archive identity is part
        # of the boundary; files in different containers cannot qualify it.
        root = path.rpartition('/')[0]
        while (archive, root) not in owners and root:
            root = root.rpartition('/')[0]
        owner = owners.get((archive, root))
        if owner and not root and not re.search(r'(?:^|/)(?:point_cloud(?:/|\.ply$)|(?:inside|surface)_gaussians\.ply$|gaussians\.ply$|points3d\.ply$|fused(?:_aligned)?\.ply$|input\.ply$)', path, re.I):
            # A repository-root reconstruction does not establish ownership of
            # arbitrary objects elsewhere in the repository.
            continue
        if owner:
            inventory = inventories[(archive, root)]
            inventory.add(path)
            if owner[2] is None:
                owner[2] = {}
            if path not in owner[2].values() and len(owner[2]) < MAX_SCENE_FILE_LINKS:
                owner[2]['asset:' + path] = path
    if details is not None:
        for row, root in scenes:
            inventory = inventories[(row[3], root)]
            details[(row[0], row[1], row[3])] = {'listedAssets': len(inventory), 'linkedAssets': len(row[2] or {}),
                                                'linksTruncated': len(inventory) > len(row[2] or {})}
    return [row for row, _ in scenes]
