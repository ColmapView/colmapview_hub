import { MAX_PREVIEW_BYTES, PREVIEW_HEIGHT, PREVIEW_WIDTH } from '../shared/model';

export async function prepareThumbnail(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 32 * 1024 * 1024) throw new Error('Choose a JPEG, PNG, or WebP image under 32 MiB.');
  const bitmap = await createImageBitmap(file, { resizeWidth: PREVIEW_WIDTH, resizeQuality: 'high' });
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#151515';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    for (const quality of [0.7, 0.6, 0.5, 0.4, 0.3]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to prepare this preview.')), 'image/jpeg', quality));
      if (blob.size <= MAX_PREVIEW_BYTES) return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.onerror = () => reject(new Error('Unable to prepare this preview.'));
        reader.readAsDataURL(blob);
      });
    }
    throw new Error('This preview cannot fit the thumbnail limit. Choose a simpler image.');
  } finally { bitmap.close(); }
}
