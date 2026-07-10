import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import PatchCard from './PatchCard.jsx';
import {
  onUpdateStateChange,
  applyAppUpdate,
  checkForUpdate,
} from '../../lib/app-update.js';

function PendingWorkCallout({ cart, queue }) {
  const parts = [];
  if (cart > 0) parts.push(`???????? ${cart} ??????`);
  if (queue > 0) parts.push(`?????????? ${queue} ??????`);
  if (!parts.length) return null;

  return (
    <div className="aug-warn" role="alert">
      <Icon name="alert" size={16} className="shrink-0 mt-0.5 text-warning" />
      <span>
        {parts.join(' · ')} — ????????????????????????
      </span>
    </div>
  );
}

export default function AppUpdateGate() {
  const [state, setState] = useState({
    status: 'idle',
    patches: [],
    pendingWork: { cart: 0, queue: 0 },
    error: null,
  });

  useEffect(() => onUpdateStateChange(setState), []);

  const { status, patches, pendingWork, error } = state;
  const open = status === 'available' || status === 'applying' || status === 'error';
  const isApplying = status === 'applying';
  const isError = status === 'error';
  const blocked = pendingWork.cart > 0 || pendingWork.queue > 0;

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const handleApply = () => {
    applyAppUpdate().catch(() => {});
  };

  const handleRetryCheck = () => {
    checkForUpdate().catch(() => {});
  };

  return createPortal(
    <div
      className="aug-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="aug-title"
      aria-describedby="aug-desc"
    >
      <div className="aug-shell" onClick={(e) => e.stopPropagation()}>
        <header className="aug-header">
          <div className="aug-header__icon" aria-hidden>
            <Icon name="refresh" size={20} color="#fff" />
          </div>
          <h2 id="aug-title" className="aug-header__title">
            {isApplying ? '??????????????' : '??????????????'}
          </h2>
          <p id="aug-desc" className="aug-header__sub">
            {isApplying
              ? '????????? — ???????????????????????????'
              : '???????????????????????? ????????????????????????????????'}
          </p>
        </header>

        <div className="aug-body">
          {!isApplying && !isError && blocked && (
            <PendingWorkCallout cart={pendingWork.cart} queue={pendingWork.queue} />
          )}

          {!isApplying && patches.length > 0 && (
            <div className="ul-card-list">
              {patches.map((patch, i) => (
                <PatchCard
                  key={patch.id}
                  patch={patch}
                  isLatest={i === 0}
                  compact={patches.length > 1}
                />
              ))}
            </div>
          )}

          {!isApplying && !isError && patches.length === 0 && (
            <div className="aug-empty-patch">
              ????????????????? — ?????????????????????????????????
            </div>
          )}

          {isError && error && (
            <div className="aug-error">{error}</div>
          )}
        </div>

        <footer className="aug-footer">
          {isApplying ? (
            <button type="button" className="btn-primary" disabled>
              <span className="spinner" /> ???????????…
            </button>
          ) : isError ? (
            <button type="button" className="btn-primary" onClick={handleRetryCheck}>
              ???????????
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={handleApply}
              disabled={blocked}
            >
              ?????????
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
