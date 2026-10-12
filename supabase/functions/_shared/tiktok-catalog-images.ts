/** Pick first HTTP(S) URL from TikTok API image fields (string, object, or array). */
export function pickFirstUrl(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const s = value.trim();
    return /^https?:\/\//i.test(s) ? s : undefined;
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
      || pickFirstUrl(o.uri)
      || pickFirstUrl(o.urls)
      || pickFirstUrl(o.url_list)
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

/**
 * Image for one SKU of a listing. The listing's main photo is used only when
 * the listing has a single SKU: on a multi-variant listing (e.g. MTP-V300D
 * 1A + 1A2) every SKU without its own photo would otherwise get the same
 * main photo, and the POS shows two models with one picture.
 */
export function resolveListingSkuImageUrl(
  product: Record<string, unknown>,
  skuId: string,
): string | undefined {
  const skus = (product?.skus as Record<string, unknown>[]) || [];
  const productImage = skus.length <= 1 ? extractProductImageUrl(product) : undefined;
  const sku = skus.find(s => String(s.id || s.sku_id) === String(skuId));
  if (sku) return extractSkuImageUrl(sku, productImage);
  return productImage;
}

/**
 * Same picture? TikTok CDN URLs carry signed, expiring query params, so two
 * fetches of one photo differ after "?". Compare host + path only.
 */
export function sameImageUrl(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const strip = (u: string) => {
    try {
      const x = new URL(u);
      return x.host + x.pathname;
    } catch {
      return u.split('?')[0];
    }
  };
  return strip(a) === strip(b);
}
