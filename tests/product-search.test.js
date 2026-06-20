import { describe, it, expect } from 'vitest';
import {
  normalizeSearchRow,
  needsBrowseCatalog,
  PRODUCT_SEARCH_LIMIT,
} from '../src/lib/product-search.js';

describe('normalizeSearchRow', () => {
  it('picks found image from array join', () => {
    const row = normalizeSearchRow({
      id: 1,
      name: 'MTP-1302',
      product_images: [
        { status: 'pending', image_url: null },
        { status: 'found', image_url: 'https://x/img.jpg' },
      ],
    });
    expect(row.product_images).toBeUndefined();
    expect(row._imageRow.image_url).toBe('https://x/img.jpg');
  });
});

describe('needsBrowseCatalog', () => {
  const base = {
    brand: 'all',
    series: '',
    subType: '',
    material: '',
    color: '',
    minPrice: 0,
    maxPrice: 0,
  };

  it('false for default filters', () => {
    expect(needsBrowseCatalog(base)).toBe(false);
  });

  it('true when brand chip selected', () => {
    expect(needsBrowseCatalog({ ...base, brand: 'casio' })).toBe(true);
  });

  it('true for price range', () => {
    expect(needsBrowseCatalog({ ...base, minPrice: 1000 })).toBe(true);
  });
});

describe('PRODUCT_SEARCH_LIMIT', () => {
  it('is 50', () => {
    expect(PRODUCT_SEARCH_LIMIT).toBe(50);
  });
});
