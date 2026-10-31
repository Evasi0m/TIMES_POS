import { describe, it, expect } from 'vitest';
import { fallbackImageUrl } from '../src/lib/product-image-fallback.js';
import { productImageUrl } from '../src/lib/product-classify.js';

describe('fallbackImageUrl', () => {
  it('finds the spreadsheet link by model, ignoring dashes/case', () => {
    expect(fallbackImageUrl('GPR-H1000-1')).toMatch(/casio\.com.*GPR-H1000-1\.png$/);
    expect(fallbackImageUrl('gpr h1000-1')).toMatch(/GPR-H1000-1\.png$/);
  });
  it('strips a distributor suffix', () => {
    expect(fallbackImageUrl('GPR-H1000-1DR')).toMatch(/GPR-H1000-1\.png$/);
  });
  it('returns null for unknown models', () => {
    expect(fallbackImageUrl('NOT-A-MODEL-99')).toBeNull();
    expect(fallbackImageUrl('')).toBeNull();
  });
});

describe('productImageUrl', () => {
  it('prefers the TikTok/catalog photo row', () => {
    const p = { name: 'GPR-H1000-1', product_images: { status: 'found', image_url: 'https://tiktok.example/a.jpg' } };
    expect(productImageUrl(p)).toBe('https://tiktok.example/a.jpg');
  });
  it('falls back to the spreadsheet link when not matched', () => {
    expect(productImageUrl({ name: 'GPR-H1000-1' })).toMatch(/GPR-H1000-1\.png$/);
    expect(productImageUrl({ name: 'GPR-H1000-1', product_images: { status: 'not_found' } })).toMatch(/GPR-H1000-1\.png$/);
  });
});

describe('productBackupImageUrl', () => {
  it('gives the spreadsheet link even when a TikTok photo exists', async () => {
    const { productBackupImageUrl } = await import('../src/lib/product-classify.js');
    const p = { name: 'GPR-H1000-1DR', product_images: { status: 'found', image_url: 'https://tiktok.example/a.jpg' } };
    expect(productBackupImageUrl(p)).toMatch(/GPR-H1000-1\.png$/);
  });
});
