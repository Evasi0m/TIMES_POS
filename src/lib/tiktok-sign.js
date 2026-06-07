// TikTok Shop Open API request signing (pure JS — unit-tested).
// Algorithm mirrors supabase/functions/_shared/tiktok-client.ts

import { createHmac } from 'node:crypto';

/**
 * @param {string} path  e.g. /order/202309/orders/search
 * @param {Record<string, string|number|undefined|null>} query  excludes sign, access_token
 * @param {string} body  JSON string or ''
 * @param {string} appSecret
 */
export function signTikTokRequest(path, query, body, appSecret) {
  const params = { ...query };
  delete params.sign;
  delete params.access_token;
  const keys = Object.keys(params).filter(k => params[k] != null && params[k] !== '').sort();
  let base = appSecret + path;
  for (const k of keys) {
    base += k + String(params[k]);
  }
  if (body) base += body;
  base += appSecret;
  return createHmac('sha256', appSecret).update(base).digest('hex');
}

/** @param {string} payload @param {string} secret */
export function signWebhookPayload(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('hex');
}
