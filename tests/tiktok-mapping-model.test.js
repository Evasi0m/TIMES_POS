import { describe, expect, it } from 'vitest';
import {
  bestSameModelProduct,
  isLikelyWrongTikTokModel,
  rankPosModelsForTikTokSku,
} from '../src/lib/tiktok-mapping-model.js';

describe('isLikelyWrongTikTokModel', () => {
  it('flags a different colourway', () => {
    expect(isLikelyWrongTikTokModel('MTP-V300D-1A', 'MTP-V300D-1A2VDF')).toBe(true);
  });

  it('accepts the same model with a distributor suffix', () => {
    expect(isLikelyWrongTikTokModel('MTP-V300D-1A', 'MTP-V300D-1AUDF')).toBe(false);
    expect(isLikelyWrongTikTokModel('MTP-V300D-1A2', 'MTP-V300D-1A2VDF')).toBe(false);
  });

  it('ignores generic TikTok SKUs', () => {
    expect(isLikelyWrongTikTokModel('DEFAULT', 'MTP-V300D-1A2VDF')).toBe(false);
  });
});

describe('bestSameModelProduct', () => {
  const products = [
    { id: 9544, name: 'MTP-V300D-1A2VDF' },
    { id: 7452, name: 'MTP-V300D-1AUDF' },
  ];

  it('picks the colourway that matches the TikTok SKU', () => {
    expect(bestSameModelProduct('MTP-V300D-1A', products)?.id).toBe(7452);
  });

  it('skips the product that is already linked', () => {
    expect(bestSameModelProduct('MTP-V300D-1A', products, { excludeId: 7452 })).toBeNull();
  });

  it('ranks the same model ahead of a longer colourway', () => {
    const ranked = rankPosModelsForTikTokSku('MTP-V300D-1A', products);
    expect(ranked[0].product.id).toBe(7452);
  });
});
