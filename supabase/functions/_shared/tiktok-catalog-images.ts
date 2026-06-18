/** Convert TikTok internal image URI to HTTPS (SG seller CDN). */
function tiktokUriToHttps(uri: string): string | undefined {
  const trimmed = uri.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (!trimmed || trimmed.startsWith('data:')) return undefined;
  return `https://p16-oec-sg.ibyteimg.com/${trimmed}~tplv-aphluv4xwc-origin-jpeg.jpeg`;
}

/** Pick first HTTP(S) URL from TikTok API image fields (string, object, or array). */
export function pickFirstUrl(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^https?:\/\//i.test(s)) return s;
    return tiktokUriToHttps(s);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const u = pickFirstUrl(item);
      if (u) return u;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return pickFirstUrl(o.url)
      || pickFirstUrl(o.urls)
      || pickFirstUrl(o.url_list)
      || pickFirstUrl(o.uri)
      || pickFirstUrl(o.thumb_url)
      || pickFirstUrl(o.thumb_urls)
      || pickFirstUrl(o.image_url)
      || pickFirstUrl(o.image_urls);
  }
  return undefined;
}

/** Product-level image from catalog search or product detail payload. */
export function extractProductImageUrl(product: Record<string, unknown>): string | undefined {
  return pickFirstUrl(product.thumb_url)
    || pickFirstUrl(product.main_images)
    || pickFirstUrl(product.main_image)
    || pickFirstUrl(product.images)
    || pickFirstUrl(product.product_image)
    || pickFirstUrl(product.image);
}

/** SKU-level image; falls back to product-level image. */
export function extractSkuImageUrl(
  sku: Record<string, unknown>,
  productImage?: string,
): string | undefined {
  const direct = pickFirstUrl(sku.sku_image)
    || pickFirstUrl(sku.sku_image_url)
    || pickFirstUrl(sku.sku_img)
    || pickFirstUrl(sku.image)
    || pickFirstUrl(sku.thumb_url);
  if (direct) return direct;

  const attrs = (sku.sales_attributes as Record<string, unknown>[]) || [];
  for (const attr of attrs) {
    const u = pickFirstUrl(attr?.sku_image)
      || pickFirstUrl(attr?.sku_img)
      || pickFirstUrl(attr?.image_url)
      || pickFirstUrl(attr?.image);
    if (u) return u;
  }
  return productImage;
}
