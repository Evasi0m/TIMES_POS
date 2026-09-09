import React, { useEffect, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import Icon from '../ui/Icon.jsx';
import PosProductMatcher from './tiktok-confirm/PosProductMatcher.jsx';
import { sb } from '../../lib/supabase-client.js';
import { getProductCatalog } from '../../lib/product-catalog-cache.js';

/**
 * Replace a POS cart line with a different catalog product.
 * Reuses TikTok confirm matcher so staff can search / pick nearby models.
 */
export default function PosCartSwapSheet({ open, line, onClose, onSwap }) {
  const [catalog, setCatalog] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      setCatalogError(null);
      try {
        const { data, error } = await getProductCatalog(sb);
        if (cancelled) return;
        if (error) {
          setCatalogError(error.message || String(error));
          setCatalog([]);
        } else {
          setCatalog(data || []);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const matcherItem = line
    ? { seller_sku: line.product_name, product_name: line.product_name }
    : null;

  return (
    <Modal open={open} onClose={onClose} title="?????????????????" wide>
      {line && (
        <div className="space-y-3">
          <div className="text-sm text-muted leading-relaxed">
            ??? <span className="font-mono font-semibold text-ink">{line.product_name}</span>
            {' '}? ??????????????????? (?????????????????????????????)
          </div>
          <PosProductMatcher
            item={matcherItem}
            catalog={catalog}
            catalogLoading={catalogLoading}
            catalogError={catalogError}
            onRetryCatalog={() => getProductCatalog(sb, { force: true }).then(({ data, error }) => {
              if (error) setCatalogError(error.message || String(error));
              else { setCatalogError(null); setCatalog(data || []); }
            })}
            onPick={(p) => onSwap(p)}
            layout="focus"
            recommendLimit={6}
          />
          <button type="button" className="btn-secondary w-full !py-2" onClick={onClose}>
            <Icon name="x" size={14}/> ??????
          </button>
        </div>
      )}
    </Modal>
  );
}
