import React, { useState, useEffect } from 'react';
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

// Brand → monogram letter + tile/ink colours. Casio and Citizen both start
// with "C", so they are kept visually distinct by colour.
const BRAND_MONO = {
  casio:   { letter: 'C', bg: '#0f2c54', ink: '#dbe7fb' }, // navy
  seiko:   { letter: 'S', bg: '#1c1917', ink: '#e7c873' }, // black / gold
  alba:    { letter: 'A', bg: '#0e4d8b', ink: '#cfe6ff' }, // blue
  citizen: { letter: 'C', bg: '#7f1d1d', ink: '#fbd5d5' }, // deep red
};

export default function ProductThumb({ product, size = 'md', className = '' }) {
  const px = SIZES[size] || SIZES.md;
  const url = product?._imageUrl ?? productImageUrl(product);
  const [broken, setBroken] = useState(false);

  // A fresh url (e.g. search results re-rendering the same slot) should clear a
  // previous load failure so the new image gets a chance to render.
  useEffect(() => { setBroken(false); }, [url]);

  const tile =
    'flex-shrink-0 inline-flex items-center justify-center overflow-hidden ' +
    'rounded-[10px] ring-1 ring-hairline ' + className;

  if (url && !broken) {
    return (
      <div className={tile + ' bg-surface-soft'} style={{ width: px, height: px }}>
        <img
          src={url}
          alt={product?.name || ''}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="w-full h-full object-contain"
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
        className={tile + ' font-display font-semibold select-none'}
        style={{
          width: px, height: px,
          background: mono.bg, color: mono.ink,
          fontSize: Math.round(px * 0.42), lineHeight: 1,
        }}
        aria-hidden="true"
      >
        {mono.letter}
      </div>
    );
  }

  // Unknown brand → neutral watch glyph on a soft tile.
  return (
    <div
      className={tile + ' bg-surface-soft text-muted-soft'}
      style={{ width: px, height: px }}
      aria-hidden="true"
    >
      <Icon name="watch" size={Math.round(px * 0.5)} />
    </div>
  );
}
