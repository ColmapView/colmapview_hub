/** Reviewed capture characteristics, independent of source count and frame selectors. */
export const VIDEO_CAPTURE_LABELS = {
  synchronized_multiview: 'Synchronized multi-view',
  moving_camera: 'Moving camera',
  unclassified: 'Not classified',
} as const;

export type VideoCaptureType = keyof typeof VIDEO_CAPTURE_LABELS;

export function isVideoCaptureType(value: unknown): value is VideoCaptureType {
  return typeof value === 'string' && Object.hasOwn(VIDEO_CAPTURE_LABELS, value);
}
