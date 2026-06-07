// Official marketplace brand marks — served from public/ecommerce/.
const BRAND_SRC = {
  tiktok: 'ecommerce/tiktok-shop.png',
  shopee: 'ecommerce/shopee.png',
  lazada: 'ecommerce/lazada.png',
};

/** @param {{ brand: 'tiktok'|'shopee'|'lazada', size?: number, className?: string }} props */
export default function EcommerceBrandIcon({ brand, size = 20, className = '' }) {
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
