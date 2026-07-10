/**
 * Eye / pupil geometry per TICK mood (viewBox 0 0 512 512).
 * Used by useEyeTracking for pointer-follow pupil offsets.
 */

export const TICK_EYE_CONFIG = {
  happy: {
    tracking: 'both',
    eyes: [
      { cx: 204.8, cy: 256, pupilCx: 217.6, pupilCy: 268.8, maxOffset: 14 },
      { cx: 307.2, cy: 256, pupilCx: 320, pupilCy: 268.8, maxOffset: 14 },
    ],
  },
  love: {
    tracking: 'both',
    eyes: [
      { cx: 204.8, cy: 256, pupilCx: 217.6, pupilCy: 268.8, maxOffset: 14 },
      { cx: 307.2, cy: 256, pupilCx: 320, pupilCy: 268.8, maxOffset: 14 },
    ],
  },
  wow: {
    tracking: 'both',
    eyes: [
      { cx: 204.8, cy: 235.73, pupilCx: 217.6, pupilCy: 248.53, maxOffset: 14 },
      { cx: 307.2, cy: 235.73, pupilCx: 320, pupilCy: 248.53, maxOffset: 14 },
    ],
  },
  wink: {
    tracking: 'left',
    eyes: [
      { cx: 205.87, cy: 256, pupilCx: 218.67, pupilCy: 268.8, maxOffset: 14 },
    ],
  },
  sleep: {
    tracking: 'none',
    eyes: [],
  },
};

export const TRACKABLE_MOODS = ['happy', 'love', 'wow', 'wink', 'sleep'];
