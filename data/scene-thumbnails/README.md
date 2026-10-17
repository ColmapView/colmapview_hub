# Scene photograph previews

These small JPEGs are center-square crops of source dataset photographs. They
retain their original image licenses; the Hub's code license does not replace
those terms. Each filename is the SHA-256 of its JPEG bytes.

Find a file's original path, source hash, attribution, image license and optional
license/source links in the matching `thumbnail` records in
`../scene-contents.json.gz`. Source collection IDs and pinned revisions identify
the original dataset. An image's license can differ from its collection's license.
MegaUnScene photographer and license records come from its pinned `images.csv`.

Prepared previews are 320 × 320, without original EXIF metadata, and under 64 KiB.
Only previews referenced by published scenes are copied to public static assets.
