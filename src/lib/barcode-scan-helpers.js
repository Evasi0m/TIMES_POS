/** Barcode camera helpers — retail formats, iOS tuning, reticle crop. */

/** POS retail barcodes (watches); skip QR/Code39 to speed up detection. */
export const RETAIL_BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

/** Matches `.scanner-reticle` CSS: width ratio × aspect 0.62 height. */
export const RETICLE_WIDTH_RATIO = 0.82;
export const RETICLE_HEIGHT_OF_WIDTH = 0.62;

export function isIOSDevice() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}

/** Native BarcodeDetector loop interval (ms). iOS: slightly conservative for thermal/battery. */
export function nativeScanIntervalMs() {
  return isIOSDevice() ? 72 : 56;
}

export function buildCameraConstraints(facing) {
  const ios = isIOSDevice();
  return {
    facingMode: { ideal: facing },
    width: { ideal: ios ? 1920 : 1280 },
    height: { ideal: ios ? 1080 : 720 },
    focusMode: { ideal: 'continuous' },
  };
}

/**
 * Crop the centre reticle region from a video frame into `canvas` (reused).
 * Returns canvas for BarcodeDetector, or null if video not ready.
 */
export function cropVideoToReticleCanvas(video, canvas) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !canvas) return null;

  let cropW = vw * RETICLE_WIDTH_RATIO;
  let cropH = cropW * RETICLE_HEIGHT_OF_WIDTH;
  if (cropH > vh * 0.88) {
    cropH = vh * 0.88;
    cropW = cropH / RETICLE_HEIGHT_OF_WIDTH;
  }
  const sx = Math.max(0, (vw - cropW) / 2);
  const sy = Math.max(0, (vh - cropH) / 2);
  const w = Math.round(cropW);
  const h = Math.round(cropH);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, w, h);
  return canvas;
}

export function intersectFormats(requested, supported) {
  if (!supported?.length) return requested;
  const set = new Set(supported.map((f) => String(f).toLowerCase()));
  const hit = requested.filter((f) => set.has(f.toLowerCase()));
  return hit.length ? hit : requested;
}
