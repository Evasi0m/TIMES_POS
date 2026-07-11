import { describe, it, expect, vi } from 'vitest';
import {
  RETAIL_BARCODE_FORMATS,
  cropVideoToReticleCanvas,
  intersectFormats,
  nativeScanIntervalMs,
  isIOSDevice,
} from '../src/lib/barcode-scan-helpers.js';

describe('barcode-scan-helpers', () => {
  it('retail formats are EAN/UPC focused', () => {
    expect(RETAIL_BARCODE_FORMATS).toContain('ean_13');
    expect(RETAIL_BARCODE_FORMATS).not.toContain('qr_code');
  });

  it('intersectFormats keeps only supported', () => {
    expect(intersectFormats(['ean_13', 'qr_code'], ['ean_13', 'code_128'])).toEqual(['ean_13']);
  });

  it('intersectFormats falls back when no overlap', () => {
    expect(intersectFormats(['ean_13'], [])).toEqual(['ean_13']);
  });

  it('cropVideoToReticleCanvas draws centre region', () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
    };
    const video = { videoWidth: 1000, videoHeight: 800 };
    const out = cropVideoToReticleCanvas(video, canvas);
    expect(out).toBe(canvas);
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(drawImage).toHaveBeenCalledOnce();
  });

  it('nativeScanIntervalMs is faster than legacy 160ms', () => {
    expect(nativeScanIntervalMs()).toBeLessThan(160);
  });

  it('isIOSDevice returns boolean', () => {
    expect(typeof isIOSDevice()).toBe('boolean');
  });
});
