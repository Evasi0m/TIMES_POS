import React, { useState, useEffect, useMemo } from 'react';
import Icon from './Icon.jsx';
import { productImageUrl, classifyBrand } from '../../lib/product-classify.js';

/**
 * Product thumbnail with a graceful brand-monogram fallback.
 *
 * Real image → <img object-contain> on a soft rounded tile. Brand product CDNs
 * (casio.com, albawatches.com, …) sometimes 404 or hotlink-block, so an
 * `onError` flips the broken image to the same placeholder a no-image product
 * gets. ~99.95% of the catalog has no image yet, so the placeholder is the
 * common case and is meant to look intentional, not "missing".
 *
 * Placeholder = brand initial in a brand-tinted tile (monogram). Unknown brand
 * ('other' / 'อื่น ๆ') has no meaningful initial, so it falls back to the
 * neutral `watch` icon from the shared Icon set.
 */

const SIZES = { sm: 40, md: 56, lg: 96, xl: 160 };

// Brand → monogram letter + gradient/ink colours.
// Gradients give a liquid-glass depth while keeping brand recognition.
const BRAND_MONO = {
  casio:   { letter: 'C', gradient: 'linear-gradient(180deg, #1a4470 0%, #0f2c54 50%, #0a1f3d 100%)', ink: '#dbe7fb' }, // navy
  seiko:   { letter: 'S', gradient: 'linear-gradient(180deg, #2d2a28 0%, #1c1917 50%, #141210 100%)', ink: '#e7c873' }, // black / gold
  alba:    { letter: 'A', gradient: 'linear-gradient(180deg, #1e6bb5 0%, #0e4d8b 50%, #0a3a6b 100%)', ink: '#cfe6ff' }, // blue
  citizen: { letter: 'C', gradient: 'linear-gradient(180deg, #a03030 0%, #7f1d1d 50%, #5f1515 100%)', ink: '#fbd5d5' }, // deep red
};

export default function ProductThumb({ product, size = 'md', className = '' }) {
  const px = SIZES[size] || SIZES.md;
  const url = product?._imageUrl ?? productImageUrl(product);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // A fresh url (e.g. search results re-rendering the same slot) should clear a
  // previous load failure / loaded flag so the new image re-shows its skeleton.
  useEffect(() => { setBroken(false); setLoaded(false); }, [url]);

  // Cache-buster: the shop wants product photos fetched fresh, never served from
  // the browser's HTTP cache. A per-mount token (stable across re-renders, new on
  // each mount or url change) appends a unique query so the URL is always "new".
  const cacheBustedUrl = useMemo(() => {
    if (!url) return null;
    return url + (url.includes('?') ? '&' : '?') + 'cb=' + Date.now();
  }, [url]);

  // Liquid glass container base classes
  const tileBase =
    'flex-shrink-0 inline-flex items-center justify-center overflow-hidden ' +
    'rounded-[10px] relative ' + className;

  // Glass border overlay for placeholder tiles
  const glassOverlay =
    'absolute inset-0 rounded-[10px] pointer-events-none ' +
    'border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.15)] ' +
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-1/2 " +
    'before:bg-gradient-to-b before:from-white/20 before:to-transparent before:rounded-t-[10px]';

  if (url && !broken) {
    return (
      <div className={tileBase + ' bg-surface-soft ring-1 ring-hairline'} style={{ width: px, height: px }}>
        {/* Loading skeleton — only for products that actually have an image URL.
            Stays until onLoad fires; products without a URL never reach here. */}
        {!loaded && <span className="skeleton absolute inset-0 !rounded-none" aria-hidden="true" />}
        <img
          src={cacheBustedUrl}
          alt={product?.name || ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          className={'w-full h-full object-contain transition-opacity duration-200 ' + (loaded ? 'opacity-100' : 'opacity-0')}
        />
      </div>
    );
  }

  // ProductsView rows are enriched (carry `_brand`); POS search results are raw
  // products, so derive the brand on the fly when it's absent.
  const brand = product?._brand ?? classifyBrand(product?.name);
  const mono = BRAND_MONO[brand];
  if (mono) {
    return (
      <div
        className={tileBase + ' font-display font-semibold select-none group ' + glassOverlay}
        style={{
          width: px, height: px,
          background: mono.gradient, color: mono.ink,
          fontSize: Math.round(px * 0.42), lineHeight: 1,
          textShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}
        aria-hidden="true"
      >
        <span className="relative inline-block transition-all duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.8)] group-hover:[text-shadow:0_0_12px_rgba(255,255,255,0.6),0_0_24px_rgba(255,255,255,0.4)]">
          {mono.letter}
        </span>
      </div>
    );
  }

  // Unknown brand → neutral watch glyph on a soft tile with liquid glass effect.
  return (
    <div
      className={tileBase + ' bg-surface-soft text-muted-soft group ' + glassOverlay}
      style={{ width: px, height: px }}
      aria-hidden="true"
    >
      <span className="transition-all duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]">
        <Icon name="watch" size={Math.round(px * 0.5)} />
      </span>
    </div>
  );
}
