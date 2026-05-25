// Image preparation pipeline for the AI bill scanner.
//
// Takes a user-supplied File/Blob (from file picker, drag-drop, paste,
// or native camera) and produces a base64-encoded JPEG sized for the
// cmg-bill-parse edge function. The edge fn caps incoming payload at
// ~6 MB of base64 (≈ 4.5 MB raw); we target much smaller to keep the
// Gemini call cheap + fast.
//
// Pipeline:
//   1. Validate that the file looks like an image
//   2. Decode via createImageBitmap (handles EXIF orientation natively
//      on modern Chrome/Safari/Firefox)
//   3. Decide whether to re-encode:
//        - Small + low-res JPEG/WebP → use bytes as-is (no quality loss)
//        - Anything else → canvas re-encode JPEG at q=0.85
//   4. If final base64 is still > ~5 MB, shrink longer-edge to 1280 and
//      re-encode (a safety net for huge phone shots).
//
// Returns { base64, mime, originalSize, finalSize, width, height }.
// All sizes are byte-counts of the raw image (not the base64 string).

// Longer-edge target in pixels. 1600 is plenty for a printed CMG invoice
// (Gemini Flash reads 8-pt fonts at 1024 reliably; we leave headroom for
// crumpled/skewed bills).
const TARGET_LONGER_EDGE = 1600;
// Fallback if the first pass still produces too much data.
const FALLBACK_LONGER_EDGE = 1280;
// Below this raw byte count + already JPEG/WebP at sensible dimensions
// we skip the canvas pass entirely (preserves original quality).
const SKIP_RESIZE_BYTE_THRESHOLD = 1_500_000;
const SKIP_RESIZE_PX_THRESHOLD   = 1800;
// Maximum base64 string length we'll send to the edge fn. The fn itself
// rejects > 8 MB; we leave margin. 5 MB raw ≈ 6.7 MB base64.
const MAX_FINAL_BYTES = 5_000_000;

/** Reject obviously non-image files BEFORE decoding (saves bandwidth on
 *  bizarre user input like dragging a PDF into the dropzone). */
function isImageType(file) {
  if (!file || typeof file !== 'object') return false;
  return typeof file.type === 'string' && file.type.startsWith('image/');
}

/** Decode a file to an ImageBitmap. createImageBitmap is the only
 *  cross-browser API that auto-applies EXIF orientation (which iPhone
 *  photos rely on heavily — without it, vertical shots come out sideways). */
async function decodeImage(file) {
  if (typeof createImageBitmap !== 'function') {
    throw new Error('เบราว์เซอร์นี้ไม่รองรับการอ่านไฟล์รูป');
  }
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (e) {
    // Most common failure: HEIC/HEIF on non-Safari. Browsers either
    // accept it natively (Safari) or refuse to decode (Chrome/Firefox).
    if (file.type && /heic|heif/i.test(file.type + file.name)) {
      throw new Error('ไฟล์ HEIC ไม่รองรับ — บันทึกเป็น JPG จากแอปรูปก่อนแล้วลองใหม่');
    }
    throw new Error('อ่านไฟล์รูปไม่ได้: ' + (e?.message || String(e)));
  }
}

/** Resize + encode via canvas. Returns Blob of type image/jpeg. */
async function canvasEncode(bitmap, longerEdge, quality) {
  const ratio = Math.min(1, longerEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * ratio);
  const h = Math.round(bitmap.height * ratio);

  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas ไม่พร้อมใช้งาน');

  // White background — JPEG has no alpha; without this, transparent PNGs
  // come out black which trips Gemini's contrast detection on light bills.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);

  if (canvas.convertToBlob) {
    return await canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  // <canvas> fallback (Safari < OffscreenCanvas)
  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('canvas toBlob ส่งคืน null')),
      'image/jpeg',
      quality,
    );
  });
}

/** Read a Blob as base64 (no data: prefix). FileReader is the simplest
 *  cross-browser way; the Promise wrapper keeps callers async-clean. */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      // strip "data:image/jpeg;base64," prefix
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Main entry point — see file header for behavior. */
export async function prepareBillImage(file) {
  if (!isImageType(file)) {
    throw new Error('ต้องเป็นไฟล์รูปภาพ (jpg/png/webp)');
  }
  const originalSize = file.size || 0;
  if (originalSize > 25 * 1024 * 1024) {
    throw new Error('ไฟล์ใหญ่เกินไป — เกิน 25 MB · ลองถ่ายที่ resolution ต่ำลง');
  }

  const bitmap = await decodeImage(file);
  const longerEdge = Math.max(bitmap.width, bitmap.height);

  // Fast path: small enough already, and a format we know the edge fn
  // accepts. Skip the canvas round-trip to preserve original quality.
  const fastPathOk =
    originalSize <= SKIP_RESIZE_BYTE_THRESHOLD &&
    longerEdge   <= SKIP_RESIZE_PX_THRESHOLD &&
    /^(image\/jpeg|image\/png|image\/webp)$/i.test(file.type);

  let blob;
  if (fastPathOk) {
    blob = file;
  } else {
    blob = await canvasEncode(bitmap, TARGET_LONGER_EDGE, 0.85);
    // Safety net: if the encoded blob is still too big (very rare with
    // 1600px + q=0.85, but possible on extremely noisy photos), shrink
    // further at the same quality.
    if (blob.size > MAX_FINAL_BYTES) {
      blob = await canvasEncode(bitmap, FALLBACK_LONGER_EDGE, 0.82);
    }
  }
  bitmap.close?.();

  const base64 = await blobToBase64(blob);
  const mime   = blob.type || 'image/jpeg';
  return {
    base64,
    mime: /^image\/(jpeg|png|webp)$/i.test(mime) ? mime : 'image/jpeg',
    originalSize,
    finalSize: blob.size,
    width:  fastPathOk ? bitmap.width  : Math.round(bitmap.width  * Math.min(1, TARGET_LONGER_EDGE / longerEdge)),
    height: fastPathOk ? bitmap.height : Math.round(bitmap.height * Math.min(1, TARGET_LONGER_EDGE / longerEdge)),
  };
}

/** Convenience formatter used by the upload modal's preview line. */
export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024)              return `${n} B`;
  if (n < 1024 * 1024)       return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
