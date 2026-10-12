import { describe, it, expect } from 'vitest';
import {
  pickFirstUrl,
  extractProductImageUrl,
  extractSkuImageUrl,
  resolveListingSkuImageUrl,
  sameImageUrl,
} from '../supabase/functions/_shared/tiktok-catalog-images.ts';
import { catalogCapWarning } from '../src/lib/tiktok-catalog-cap.js';
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

describe('resolveListingSkuImageUrl', () => {
  const main = 'https://cdn.example/main.jpg';
  it('uses the SKU photo when it has one', () => {
    const p = { main_images: [{ urls: [main] }], skus: [{ id: '1', sku_image: 'https://cdn.example/s1.jpg' }, { id: '2' }] };
    expect(resolveListingSkuImageUrl(p, '1')).toBe('https://cdn.example/s1.jpg');
  });
  it('does not lend the main photo to a SKU on a multi-SKU listing', () => {
    const p = { main_images: [{ urls: [main] }], skus: [{ id: '1' }, { id: '2' }] };
    expect(resolveListingSkuImageUrl(p, '2')).toBeUndefined();
    expect(resolveListingSkuImageUrl(p, 'missing')).toBeUndefined();
  });
  it('uses the main photo on a single-SKU listing', () => {
    const p = { main_images: [{ urls: [main] }], skus: [{ id: '1' }] };
    expect(resolveListingSkuImageUrl(p, '1')).toBe(main);
  });
});

describe('sameImageUrl', () => {
  it('ignores signed query params', () => {
    expect(sameImageUrl('https://p16.example/a/b.jpeg?t=1&sig=x', 'https://p16.example/a/b.jpeg?t=2&sig=y')).toBe(true);
  });
  it('detects a different photo', () => {
    expect(sameImageUrl('https://p16.example/a/b.jpeg', 'https://p16.example/a/c.jpeg')).toBe(false);
  });
  it('is false when either side is missing', () => {
    expect(sameImageUrl(null, 'https://p16.example/a.jpeg')).toBe(false);
  });
});

describe('catalogCapWarning', () => {
  it('is null well under the cap', () => {
    expect(catalogCapWarning({ total: 368, max_products: 1000 })).toBeNull();
  });
  it('warns near the cap', () => {
    expect(catalogCapWarning({ total: 850, max_products: 1000 })).toMatch(/ใกล้เพดาน/);
  });
  it('warns when the load was cut off', () => {
    expect(catalogCapWarning({ products: 1000, max_products: 1000, truncated: true })).toMatch(/เกินเพดาน/);
  });
  it('is null without stats', () => {
    expect(catalogCapWarning(null)).toBeNull();
  });
});
