/** Extract only complete native pose headers from a bounded binary response.
 * Observation payloads need not fit in the response; their offsets still must
 * be safe. These headers establish name coverage, never whole-model parsing.
 */
export function binaryPoseHeaders(body) {
  if (body.length < 8) throw new Error('Missing native pose count');
  const total = Number(body.readBigUInt64LE(0));
  if (!Number.isSafeInteger(total) || total < 1) throw new Error('Invalid native pose count');
  const headers = [];
  let offset = 8;
  for (let i = 0; i < total && offset + 73 <= body.length; i++) {
    const end = body.indexOf(0, offset + 64);
    if (end < 0 || end + 9 > body.length) break;
    const tracks = Number(body.readBigUInt64LE(end + 1));
    const next = end + 9 + tracks * 24;
    if (!Number.isSafeInteger(next) || next < end + 9) throw new Error('Invalid native observation offset');
    const header = Buffer.from(body.subarray(offset, end + 9));
    header.writeBigUInt64LE(0n, header.length - 8);
    headers.push(header);
    offset = next;
  }
  if (!headers.length) throw new Error('No complete native pose header in the response');
  const count = Buffer.alloc(8);
  count.writeBigUInt64LE(BigInt(headers.length));
  return { bytes: Buffer.concat([count, ...headers]), total, inspected: headers.length };
}

/** Avoid treating a truncated final text header as a registered filename. */
export function completeTextPrefix(body, entire) {
  const text = body.toString('utf8');
  return entire ? text : text.slice(0, text.lastIndexOf('\n') + 1);
}

/** Photo selection never narrows the model's mask inventory. A complete
 * physical layout supplies owner boundaries even for explicitly typed media.
 */
export function photoRoutingInventory(row, { isPhoto, isAuxiliaryImagePath, isDatasetMaskImagePath, ownership }) {
  const candidates = row.mediaCandidates ?? [...row.photos, ...row.masks];
  const physicalPaths = [...new Set([...candidates, ...(row.modelMediaCandidates ?? []), ...Object.values(row.files)])];
  const owns = ownership(physicalPaths);
  const explicitMasks = new Set(row.masks);
  const isMask = path => explicitMasks.has(path) || isDatasetMaskImagePath(path);
  const isAuxiliary = path => isAuxiliaryImagePath(path)
    || /(?:^|\/)(?:render(?:ed)?(?:s|[_-].*)?|sam[23]_masks?|mask_color|gt_masks?|normals?(?:[_-].*)?|depths?(?:[_-].*)?|.*[_-]depth|labels?)(?:\/|$)/i.test(path);
  const photos = [...new Set(candidates.filter(path => isPhoto(path) && !isMask(path)
    && (row.photoCollection ? path.startsWith(row.photoCollection + '/') : !isAuxiliary(path))
    && (row.mediaDeclared || owns(path))))].sort();
  const masks = [...new Set([...physicalPaths, ...row.masks].filter(path => isPhoto(path) && isMask(path) && owns(path)))].sort();
  return { photos, masks, physicalPaths };
}
