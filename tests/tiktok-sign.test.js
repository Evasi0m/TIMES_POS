import { describe, it, expect } from 'vitest';
import { signTikTokRequest, signWebhookPayload } from '../src/lib/tiktok-sign.js';

describe('signTikTokRequest', () => {
  it('produces deterministic hex HMAC for known inputs', () => {
    const sig = signTikTokRequest(
      '/order/202309/orders/search',
      { app_key: 'testkey', timestamp: 1700000000 },
      '{"page_size":10}',
      'testsecret',
    );
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(signTikTokRequest(
      '/order/202309/orders/search',
      { app_key: 'testkey', timestamp: 1700000000 },
      '{"page_size":10}',
      'testsecret',
    )).toBe(sig);
  });

  it('excludes sign and access_token from base string', () => {
    const a = signTikTokRequest('/x', { app_key: 'k', sign: 'old', access_token: 'tok', timestamp: 1 }, '', 's');
    const b = signTikTokRequest('/x', { app_key: 'k', timestamp: 1 }, '', 's');
    expect(a).toBe(b);
  });

  it('sorts query keys alphabetically', () => {
    const a = signTikTokRequest('/p', { z: 1, a: 2 }, '', 'sec');
    const b = signTikTokRequest('/p', { a: 2, z: 1 }, '', 'sec');
    expect(a).toBe(b);
  });
});

describe('signWebhookPayload', () => {
  it('returns 64-char hex', () => {
    expect(signWebhookPayload('1700000000.{"type":1}', 'whsec')).toMatch(/^[a-f0-9]{64}$/);
  });
});
