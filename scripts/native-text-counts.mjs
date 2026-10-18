// Count the records the viewer actually keeps, with bounded batches rather than
// retaining millions of point objects and tracks. The caller supplies the exact
// viewer parsers; this module does not implement another COLMAP dialect.
export async function nativeTextCounts(stream, role, parsers) {
  if (!['cameras', 'images', 'points3d'].includes(role)) throw new Error('Unknown COLMAP role');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const ids = new Set();
  const cameraReferences = new Map();
  let prefix = '', pending = '', schema, batch = [], batchBytes = 0;
  let skipObservation = false;
  const parser = parsers[{ cameras: 'parseCamerasText', images: 'parseImagesText', points3d: 'parsePoints3DText' }[role]];
  const merge = map => {
    for (const [id, record] of map) {
      ids.add(id);
      if (role === 'images') cameraReferences.set(id, record.cameraId);
    }
  };
  const flush = () => {
    if (!batch.length) return;
    const map = parser(schema + batch.join('\n'));
    // Duplicates within a batch are replaced, just as in the viewer's Map.
    merge(map);
    batch = [];
    batchBytes = 0;
  };
  const line = value => {
    if (value.length > 32 * 1024 * 1024) throw new Error('COLMAP text line exceeds audit bound');
    if (role === 'images' && skipObservation) {
      skipObservation = false;
      return;
    }
    if (!value.trim() || value.trimStart().startsWith('#')) return;
    if (role === 'images') {
      const map = parser(schema + value + '\n', true);
      if (map.size) {
        merge(map);
        skipObservation = true;
      }
    } else {
      batch.push(value);
      batchBytes += value.length;
      if (batchBytes >= 256 * 1024 || batch.length >= 2048) flush();
    }
  };
  const consume = text => {
    pending += text;
    let start = 0, end;
    while ((end = pending.indexOf('\n', start)) !== -1) {
      line(pending.slice(start, end));
      start = end + 1;
    }
    pending = pending.slice(start);
    if (pending.length > 32 * 1024 * 1024) throw new Error('COLMAP text line exceeds audit bound');
  };
  const initialize = () => {
    // Match the viewer's 8192-character schema window exactly. Do not let a
    // later batch's comments change the dialect of the original file.
    schema = prefix.slice(0, 8192).split(/\r?\n/).filter(value => value.startsWith('#')).join('\n') + '\n';
    parser(schema); // Fail unsupported declared columns even in an empty file.
    consume(prefix);
    prefix = '';
  };
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true });
    if (schema === undefined) {
      prefix += text;
      if (prefix.length >= 8192) initialize();
    } else consume(text);
  }
  const tail = decoder.decode();
  if (schema === undefined) {
    prefix += tail;
    initialize();
  } else consume(tail);
  if (pending) line(pending);
  flush();
  return { count: ids.size, cameraReferences, ids };
}
