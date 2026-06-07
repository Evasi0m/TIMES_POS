import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

/**
 * Product image viewer — dim + blur backdrop, image at natural size (capped).
 * Close: backdrop click, X button, Escape.
 */
export default function ProductImageLightbox({ src, alt, onClose }) {
  const [closing, setClosing] = useState(false);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose?.(), 220);
  }, [closing, onClose]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  if (!src) return null;

  const imgClass = 'product-img-lightbox-img select-none ' +
    (closing ? 'product-img-lightbox-img--out' : 'product-img-lightbox-img--in');

  return createPortal(
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center p-4"
      onClick={requestClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt || 'ขยายภาพสินค้า'}
    >
      <div
        className={
          'absolute inset-0 product-img-lightbox-backdrop ' +
          (closing ? 'holo-backdrop-out' : 'holo-backdrop-in')
        }
      />

      <button
        type="button"
        aria-label="ปิด"
        className="absolute top-3 right-3 z-10 lightbox-btn"
        onClick={(e) => { e.stopPropagation(); requestClose(); }}
      >
        <Icon name="x" size={18}/>
      </button>

      <img
        src={src}
        alt={alt || ''}
        draggable={false}
        className={imgClass}
        referrerPolicy="no-referrer"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}
