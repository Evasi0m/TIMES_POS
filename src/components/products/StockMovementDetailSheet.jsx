import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../ui/Modal.jsx';
import BottomSheet from '../ui/mobile/BottomSheet.jsx';
import Icon from '../ui/Icon.jsx';
import ChannelBadge from '../ui/mobile/ChannelBadge.jsx';
import EcommerceBrandIcon from '../ecommerce/EcommerceBrandIcon.jsx';
import { mapError } from '../../lib/error-map.js';
import {
  STOCK_DETAIL_UI,
  buildMovementDetailView,
  fetchMovementDetail,
  movementReasonLabel,
} from '../../lib/stock-movement-detail.js';
import '../../styles/stock-movement-detail.css';

function useIsMobileLg() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const fn = () => setMobile(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return mobile;
}

function HeroIcon({ name, tone }) {
  const toneClass = tone === 'green' ? 'smd-hero__icon--green' : tone === 'red' ? 'smd-hero__icon--red' : 'smd-hero__icon--gray';
  return (
    <div className={`smd-hero__icon ${toneClass}`}>
      <Icon name={name} size={20} />
    </div>
  );
}

function DetailCard({ view }) {
  if (!view) return null;
  const { hero, channelOrder, channelProp, highlight, amount, sections, note } = view;
  const qty = Number(hero.qtyDelta) || 0;
  const qtyText = qty > 0 ? `+${qty}` : String(qty);

  return (
    <div className="smd-card">
      <div className="smd-hero">
        <div className="smd-hero__left">
          <HeroIcon name={hero.heroIcon} tone={hero.reasonTone} />
          <div className="min-w-0">
            <div className="smd-hero__title">{hero.reasonLabel}</div>
            <div className="smd-hero__meta">
              <span className="inline-flex items-center gap-1">
                <Icon name="calendar" size={13} />
                {hero.dateTime}
              </span>
            </div>
          </div>
        </div>
        <div className={`smd-hero__qty ${hero.isPositive ? 'smd-hero__qty--pos' : 'smd-hero__qty--neg'}`}>
          {qtyText}
        </div>
        {hero.balanceAfter != null && (
          <div className="smd-hero__balance">
            <span>{STOCK_DETAIL_UI.balanceLabel}</span>
            <strong>{hero.balanceAfter}</strong>
          </div>
        )}
      </div>

      {(channelOrder || channelProp) && (
        <div className="smd-channel-row">
          <span className="smd-channel-row__label">Platform</span>
          <span className="smd-channel-row__badge">
            <ChannelBadge order={channelOrder} channel={channelProp} size={22} />
          </span>
        </div>
      )}

      {highlight && (
        <div className="smd-highlight">
          {highlight.brand ? (
            <EcommerceBrandIcon brand={highlight.brand} size={22} />
          ) : (
            <Icon name="receipt" size={18} />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted-soft">{highlight.label}</div>
            <div className="smd-highlight__value">{highlight.value}</div>
          </div>
        </div>
      )}

      {amount && (
        <div className="smd-amount">
          <span className="smd-amount__label">{amount.label}</span>
          <span className="smd-amount__value">{amount.value}</span>
        </div>
      )}

      {sections.map((sec) => (
        <div key={sec.title} className="smd-section">
          <div className="smd-section__head">
            <Icon name={sec.icon} size={14} />
            {sec.title}
          </div>
          {sec.rows.map((r) => (
            <div key={`${sec.title}-${r.label}`} className="smd-row">
              <div className="smd-row__icon">
                <Icon name={r.icon} size={16} />
              </div>
              <div className="smd-row__label">{r.label}</div>
              <div className={`smd-row__value${r.mono ? ' smd-row__value--mono' : ''}${r.emphasize ? ' smd-row__value--emph' : ''}`}>
                {r.value}
              </div>
            </div>
          ))}
        </div>
      ))}

      {note && <div className="smd-note">{note}</div>}
    </div>
  );
}

function DetailBody({ view, loading, error }) {
  if (loading) {
    return (
      <div className="text-muted text-sm p-6 flex items-center gap-2 justify-center">
        <span className="spinner" />
        {STOCK_DETAIL_UI.loading}
      </div>
    );
  }
  if (error) {
    return <div className="text-error text-sm p-6 text-center">{error}</div>;
  }
  if (!view || (!view.sections?.length && !view.note && !view.amount && !view.highlight)) {
    return <div className="text-muted text-sm p-6 text-center">{STOCK_DETAIL_UI.empty}</div>;
  }
  return <DetailCard view={view} />;
}

export default function StockMovementDetailSheet({ movement, productId, open, onClose }) {
  const isMobile = useIsMobileLg();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!open || !movement || !productId) {
      setPayload(null);
      setError('');
      setLoading(false);
      return undefined;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      setError('');
      setPayload(null);
      try {
        const result = await fetchMovementDetail(movement, productId);
        if (cancel) return;
        setPayload(result);
      } catch (e) {
        if (!cancel) setError(mapError(e) || STOCK_DETAIL_UI.loadError);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [open, movement, productId]);

  const view = useMemo(() => {
    if (!movement || !payload) return null;
    return buildMovementDetailView(payload.kind, movement, payload.data);
  }, [movement, payload]);

  const title = movement
    ? `${STOCK_DETAIL_UI.titlePrefix} ${STOCK_DETAIL_UI.titleSep} ${movementReasonLabel(movement)}`
    : STOCK_DETAIL_UI.titlePrefix;

  const body = <DetailBody view={view} loading={loading} error={error} />;

  const footer = (
    <button type="button" className="btn-secondary w-full sm:w-auto" onClick={onClose}>
      {STOCK_DETAIL_UI.close}
    </button>
  );

  if (isMobile) {
    return (
      <BottomSheet open={open} onClose={onClose} title={title}>
        <div className="px-1 pb-2">{body}</div>
        <div className="pt-3 border-t hairline mt-2">{footer}</div>
      </BottomSheet>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={title} footer={footer}>
      {body}
    </Modal>
  );
}
