// Official marketplace brand marks — served from public/ecommerce/.
const BRAND_SRC = {
  tiktok: 'ecommerce/tiktok-shop.png',
  shopee: 'ecommerce/shopee.png',
  lazada: 'ecommerce/lazada.png',
};

/** @param {{ brand: 'tiktok'|'shopee'|'lazada'|'thaimart', size?: number, className?: string }} props */
export default function EcommerceBrandIcon({ brand, size = 20, className = '' }) {
  if (brand === 'thaimart') {
    // No official mark bundled yet — compact text monogram.
    return (
      <span
        aria-hidden
        className={'inline-flex items-center justify-center flex-shrink-0 select-none rounded-md font-semibold text-white ' + className}
        style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.42)), background: '#c96a86', lineHeight: 1 }}
      >
        TM
      </span>
    );
  }
  const src = BRAND_SRC[brand];
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={'object-contain flex-shrink-0 select-none ' + className}
      style={{ width: size, height: size }}
      draggable={false}
    />
  );
}

export { BRAND_SRC };
