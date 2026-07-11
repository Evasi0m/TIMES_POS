import React, { useState, useEffect } from 'react';
import Icon from './Icon.jsx';
import ExpandableImageThumb from './ExpandableImageThumb.jsx';
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

export default function ProductThumb({ product, size = 'md', fill = false, className = '' }) {
  const px = SIZES[size] || SIZES.md;
  const boxStyle = fill
    ? { width: '100%', height: '100%', aspectRatio: '1' }
    : { width: px, height: px };
  const url = product?._imageUrl ?? productImageUrl(product);
  const [broken, setBroken] = useState(false);

  // A fresh url (e.g. search results re-rendering the same slot) should clear a
  // previous load failure so the new image re-shows its skeleton.
  useEffect(() => { setBroken(false); }, [url]);

  // Photo tile — solid bg + hairline border (avoid ring-* at rounded corners).
  const photoTile =
    'flex-shrink-0 inline-flex items-center justify-center overflow-hidden ' +
    'rounded-[10px] relative bg-white border border-black/[0.07] product-img-shadow ' +
    'dark:bg-surface-soft dark:border-white/[0.08] ' + className;

  // Liquid glass container base classes (placeholders only)
  const tileBase =
    'flex-shrink-0 inline-flex items-center justify-center overflow-hidden ' +
    'rounded-[10px] relative product-img-shadow ' + className;

  // Glass border overlay for placeholder tiles
  const glassOverlay =
    'absolute inset-0 rounded-[10px] pointer-events-none ' +
    'border border-white/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.15)] ' +
    "before:content-[''] before:absolute before:inset-x-0 before:top-0 before:h-1/2 " +
    'before:bg-gradient-to-b before:from-white/20 before:to-transparent before:rounded-t-[10px]';

  if (url && !broken) {
    return (
      <ExpandableImageThumb
        src={url}
        alt={product?.name || ''}
        className={photoTile}
        style={boxStyle}
        imgClassName="w-full h-full object-contain rounded-[10px]"
        onImageError={() => setBroken(true)}
        placeholder={
          <div className={photoTile} style={boxStyle}>
            <span className="skeleton absolute inset-0 rounded-[10px]" aria-hidden="true"/>
          </div>
        }
      />
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
          ...boxStyle,
          background: mono.gradient, color: mono.ink,
          fontSize: fill ? '2.75rem' : Math.round(px * 0.42), lineHeight: 1,
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
      style={boxStyle}
      aria-hidden="true"
    >
      <span className="transition-all duration-300 group-hover:scale-110 group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]">
        <Icon name="watch" size={fill ? 48 : Math.round(px * 0.5)} />
      </span>
    </div>
  );
}
