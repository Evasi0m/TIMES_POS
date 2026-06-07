import React, { useState } from 'react';
import Icon from './Icon.jsx';
import ProductImageLightbox from './ProductImageLightbox.jsx';

/**
 * Thumbnail with expand-on-click when a real image URL is available.
 * Placeholder children render without expand affordance.
 */
export default function ExpandableImageThumb({
  src,
  alt = '',
  className = '',
  imgClassName = 'w-full h-full object-contain',
  style,
  loading = 'lazy',
  decoding = 'async',
  referrerPolicy = 'no-referrer',
  placeholder,
  onImageError,
  onImageLoad,
}) {
  const [open, setOpen] = useState(false);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const hasImage = Boolean(src) && !broken;

  if (!hasImage) {
    if (placeholder) return placeholder;
    return (
      <div
        className={'flex items-center justify-center bg-surface-soft border hairline text-muted shrink-0 ' + className}
        style={style}
        aria-hidden="true"
      >
        <Icon name="image" size={22}/>
      </div>
    );
  }

  const openLightbox = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (loaded) setOpen(true);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={loaded ? 0 : -1}
        className={'product-img-expandable border-0 p-0 bg-transparent ' + className}
        style={style}
        onClick={openLightbox}
        onKeyDown={(e) => {
          if (loaded && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openLightbox(e);
          }
        }}
        aria-label={'ขยายภาพ ' + (alt || 'สินค้า')}
        aria-disabled={!loaded}
      >
        {!loaded && <span className="skeleton absolute inset-0 !rounded-none" aria-hidden="true"/>}
        <img
          src={src}
          alt={alt}
          loading={loading}
          decoding={decoding}
          referrerPolicy={referrerPolicy}
          className={imgClassName + (loaded ? ' opacity-100' : ' opacity-0')}
          onLoad={() => { setLoaded(true); onImageLoad?.(); }}
          onError={() => { setBroken(true); onImageError?.(); }}
        />
        {loaded && (
          <span className="product-img-expand-overlay" aria-hidden="true">
            <Icon name="expand" size={22} strokeWidth={2}/>
          </span>
        )}
      </div>

      {open && (
        <ProductImageLightbox
          src={src}
          alt={alt}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
