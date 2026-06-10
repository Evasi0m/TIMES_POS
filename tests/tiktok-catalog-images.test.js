import { describe, it, expect } from 'vitest';
import {
  pickFirstUrl,
  extractProductImageUrl,
  extractSkuImageUrl,
} from '../supabase/functions/_shared/tiktok-catalog-images.ts';
import { mappingRowFromTiktokSku } from '../src/lib/tiktok-mirror-helpers.js';

describe('pickFirstUrl', () => {
  it('returns http(s) strings', () => {
    expect(pickFirstUrl('https://cdn.example/a.jpg')).toBe('https://cdn.example/a.jpg');
  });
  it('extracts from object with url', () => {
    expect(pickFirstUrl({ url: 'https://cdn.example/b.jpg' })).toBe('https://cdn.example/b.jpg');
  });
  it('extracts first from array', () => {
    expect(pickFirstUrl([{ urls: ['https://cdn.example/c.jpg'] }])).toBe('https://cdn.example/c.jpg');
  });
  it('extracts from object with urls array', () => {
    expect(pickFirstUrl({ urls: ['https://cdn.example/d.jpg'] })).toBe('https://cdn.example/d.jpg');
  });
  it('extracts thumb_urls from main_images item', () => {
    expect(pickFirstUrl({ thumb_urls: ['https://cdn.example/e.jpg'] })).toBe('https://cdn.example/e.jpg');
  });
});

describe('extractProductImageUrl', () => {
  it('prefers thumb_url then main_images', () => {
    expect(extractProductImageUrl({
      thumb_url: 'https://cdn.example/thumb.jpg',
      main_images: [{ url: 'https://cdn.example/main.jpg' }],
    })).toBe('https://cdn.example/thumb.jpg');
  });
});

describe('extractSkuImageUrl', () => {
  it('uses sku image before product fallback', () => {
    expect(extractSkuImageUrl(
      { sku_image: 'https://cdn.example/sku.jpg' },
      'https://cdn.example/product.jpg',
    )).toBe('https://cdn.example/sku.jpg');
  });
  it('falls back to product image', () => {
    expect(extractSkuImageUrl({}, 'https://cdn.example/product.jpg')).toBe('https://cdn.example/product.jpg');
  });
});

describe('catalog image extraction pipeline', () => {
  it('produces SKU image from product main_images', () => {
    const productImage = extractProductImageUrl({
      main_images: [{ url: 'https://cdn.example/product.jpg' }],
    });
    const skuImage = extractSkuImageUrl({
      id: 'sku-1',
      seller_sku: 'GA-2100',
    }, productImage);
    expect(skuImage).toBe('https://cdn.example/product.jpg');
  });
});

describe('mappingRowFromTiktokSku image_url', () => {
  it('carries image_url from catalog sku', () => {
    const row = mappingRowFromTiktokSku({
      tiktok_sku_id: 'sku-1',
      tiktok_product_id: 'prod-1',
      seller_sku: 'GA-2100',
      product_name: 'G-Shock',
      image_url: 'https://cdn.example/sku.jpg',
    }, 42);
    expect(row.image_url).toBe('https://cdn.example/sku.jpg');
  });
});
