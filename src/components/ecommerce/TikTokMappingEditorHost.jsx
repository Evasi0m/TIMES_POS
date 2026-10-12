// Shared TikTok pairing editor — opened from the TikTok badge on any page
// (POS, products, receive). Same panel as the product detail page, so
// "เปลี่ยนรุ่นจับคู่" / "ยกเลิกจับคู่" behave identically everywhere, and every
// page refreshes through the mapping bus.
import React, { useEffect, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import { registerTikTokMappingEditor } from '../../lib/tiktok-mapping-editor-bus.js';
import ProductTikTokMappingPanel from '../products/ProductTikTokMappingPanel.jsx';
import Modal from '../ui/Modal.jsx';

export default function TikTokMappingEditorHost({ toast, askConfirm }) {
  const [productId, setProductId] = useState(null);
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => registerTikTokMappingEditor((id) => setProductId(Number(id))), []);

  useEffect(() => {
    if (productId == null) { setProduct(null); return undefined; }
    let cancel = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await sb.from('products')
          .select('id, name, current_stock')
          .eq('id', productId)
          .single();
        if (error) throw error;
        if (!cancel) setProduct(data);
      } catch (e) {
        if (!cancel) {
          toast?.push('โหลดสินค้าไม่ได้: ' + mapError(e), 'error');
          setProductId(null);
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [productId, toast]);

  const close = () => setProductId(null);

  return (
    <Modal
      open={productId != null}
      onClose={close}
      title={product ? `จับคู่ TikTok · ${product.name}` : 'จับคู่ TikTok'}
      wide
      footer={<button type="button" className="btn-secondary" onClick={close}>ปิด</button>}
    >
      {loading || !product
        ? <div className="text-sm text-muted flex items-center gap-2"><span className="spinner"/> กำลังโหลด…</div>
        : <ProductTikTokMappingPanel key={product.id} product={product} toast={toast} askConfirm={askConfirm}/>}
    </Modal>
  );
}
