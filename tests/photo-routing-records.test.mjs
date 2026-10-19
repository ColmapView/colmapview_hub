import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { binaryPoseHeaders, completeTextPrefix, photoRoutingInventory } from '../scripts/audit/photo-routing-records.mjs';

function pose(name, tracks = 0) {
  const record = Buffer.alloc(64 + Buffer.byteLength(name) + 1 + 8);
  record.writeUInt32LE(17, 0);
  record.writeDoubleLE(1, 4);
  record.writeUInt32LE(2, 60);
  record.write(name, 64);
  record.writeBigUInt64LE(BigInt(tracks), record.length - 8);
  return record;
}
const model = (total, ...records) => {
  const header = Buffer.alloc(8); header.writeBigUInt64LE(BigInt(total));
  return Buffer.concat([header, ...records]);
};

test('a complete header with uncached observations remains a bounded name sample', () => {
  const result = binaryPoseHeaders(model(20, pose('front/café.png', 10000)));
  assert.equal(result.total, 20);
  assert.equal(result.inspected, 1);
  assert.equal(result.bytes.readBigUInt64LE(0), 1n);
  assert.equal(result.bytes.readBigUInt64LE(result.bytes.length - 8), 0n);
  assert.equal(result.bytes.subarray(8, -8).toString('hex'), pose('front/café.png').subarray(0, -8).toString('hex'));
});

test('observation offsets and partial following headers cannot fabricate registered names', () => {
  const prefix = model(3, pose('a.jpg', 1), Buffer.alloc(24), pose('b.jpg', 0).subarray(0, 66));
  assert.equal(binaryPoseHeaders(prefix).inspected, 1);
  assert.equal(binaryPoseHeaders(model(2, pose('a.jpg'), pose('b.jpg'))).inspected, 2);
  const overflow = pose('a.jpg'); overflow.writeBigUInt64LE(2n ** 63n, overflow.length - 8);
  assert.throws(() => binaryPoseHeaders(model(1, overflow)), /observation offset/);
  assert.throws(() => binaryPoseHeaders(Buffer.alloc(7)), /count/);
  assert.throws(() => binaryPoseHeaders(model(1, pose('a.jpg').subarray(0, 70))), /No complete/);
});

test('text prefix drops only the unfinished final line', () => {
  assert.equal(completeTextPrefix(Buffer.from('# Image list\r\n1 1 0 0 0 0 0 0 1 trunc'), false), '# Image list\r\n');
  assert.equal(completeTextPrefix(Buffer.from('last complete header'), true), 'last complete header');
});

const mediaPolicy = {
  isPhoto: path => /\.(?:jpg|png)$/.test(path), isAuxiliaryImagePath: path => path.includes('/depth/'),
  isDatasetMaskImagePath: path => path.includes('/masks/'), ownership: () => path => !path.startsWith('peer/'),
};

test('a sibling photo collection retains model-side and explicitly classified masks', () => {
  const result = photoRoutingInventory({ files: { cameras: 'model/cameras.bin', images: 'model/images.bin' },
    photos: [], masks: ['model/gt_mask/a.png'], mediaCandidates: ['photos/train/a.jpg', 'photos/test/a.jpg'],
    modelMediaCandidates: ['model/gt_mask/a.png', 'model/masks/a.jpg.png', 'model/depth/a.png'],
    photoCollection: 'photos/train', mediaDeclared: true }, mediaPolicy);
  assert.deepEqual(result.photos, ['photos/train/a.jpg']);
  assert.deepEqual(result.masks, ['model/gt_mask/a.png', 'model/masks/a.jpg.png']);
});

test('model anchors reach ownership checks and inferred media cannot borrow peer scenes', () => {
  const result = photoRoutingInventory({ files: { cameras: 'scene/cameras.bin' }, masks: [], photos: [],
    mediaCandidates: ['scene/images/a.jpg', 'scene/render_img/a.jpg', 'scene/labels/a.png', 'scene/depth/a.png', 'scene/depths_da3_mv/a.png',
      'peer/images/a.jpg', 'peer/masks/a.jpg.png', 'peer/cameras.bin', 'peer/images.bin'] },
  { ...mediaPolicy, ownership: paths => { assert.ok(paths.includes('peer/cameras.bin')); assert.ok(paths.includes('peer/images.bin')); return mediaPolicy.ownership(); } });
  assert.deepEqual(result.photos, ['scene/images/a.jpg']);
  assert.deepEqual(result.masks, []);
});
