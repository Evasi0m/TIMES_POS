import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import {
  fetchUpdateLog,
  markUpdatesSeen,
  formatPatchDate,
  patchTintTag,
  paginatePatches,
  UPDATE_LOG_PAGE_SIZE,
} from '../../lib/update-log.js';

function PatchTag({ tag }) {
  return (
    <span className={'ul-tag ul-tag--' + (tag === 'แก้บั๊ก' ? 'bug' : tag === 'ปรับปรุง' ? 'tweak' : tag === 'ใหม่' ? 'new' : 'mod')}>
      {tag}
    </span>
  );
}

function PatchCard({ patch, isLatest = false }) {
  const tint = patchTintTag(patch.tags);
  return (
    <article
      className={
        'ul-card ttc-bento rounded-2xl border p-3 min-w-0 h-auto flex-none flex flex-col gap-2 ' +
        (isLatest ? 'ul-card--hero ul-mesh-card' : 'ul-card--' + tint + ' ul-mesh-card--soft')
      }
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          {isLatest && (
            <div className="ul-hero__label text-[10px] font-semibold uppercase tracking-wider mb-1">
              อัปเดตล่าสุด
            </div>
          )}
          <h3 className="text-sm font-semibold text-ink leading-snug">
            {patch.title}
          </h3>
          <div className="text-[11px] text-muted tabular-nums mt-0.5">
            {formatPatchDate(patch.date)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[45%]">
          {(patch.tags || []).map(t => (
            <PatchTag key={t} tag={t}/>
          ))}
        </div>
      </div>
      <ul className="space-y-1.5 text-xs">
        {(patch.items || []).map((line, i) => (
          <li key={i} className="flex gap-2 text-ink/90 leading-relaxed">
            <span className="ul-bullet shrink-0" aria-hidden>✦</span>
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function UpdateLogPager({ page, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <div className="ul-pager shrink-0 flex flex-col items-center gap-2 pt-3 border-t hairline-soft mt-1">
      <div className="text-[11px] text-muted tabular-nums">
        หน้า {page}/{totalPages} · ทั้งหมด {total} รายการ
      </div>
      <div className="flex items-center gap-1 flex-wrap justify-center">
        <button
          type="button"
          className="ul-pager__nav"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="หน้าก่อน"
        >
          <Icon name="chevron-l" size={14}/>
        </button>
        {pages.map(n => (
          <button
            key={n}
            type="button"
            className={'ul-pager__page' + (n === page ? ' is-active' : '')}
            onClick={() => onPageChange(n)}
            aria-label={'หน้า ' + n}
            aria-current={n === page ? 'page' : undefined}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          className="ul-pager__nav"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="หน้าถัดไป"
        >
          <Icon name="chevron-r" size={14}/>
        </button>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="ul-card-list animate-pulse">
      <div className="ul-card ul-mesh-card rounded-2xl border p-3 space-y-2">
        <div className="h-4 w-2/3 rounded bg-black/5"/>
        <div className="h-3 w-1/4 rounded bg-black/5"/>
        <div className="h-3 w-full rounded bg-black/5"/>
        <div className="h-3 w-5/6 rounded bg-black/5"/>
      </div>
      <div className="ul-card rounded-2xl border p-3 space-y-2">
        <div className="h-4 w-1/2 rounded bg-black/5"/>
        <div className="h-3 w-full rounded bg-black/5"/>
        <div className="h-3 w-4/5 rounded bg-black/5"/>
      </div>
    </div>
  );
}

export default function UpdateLogModal({ open, closing, onClose }) {
  const [log, setLog] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUpdateLog();
      setLog(data);
      setPage(1);
      markUpdatesSeen(data);
    } catch (e) {
      setError(e?.message || 'โหลดไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  if (!open) return null;

  const patches = log?.patches || [];
  const { items, page: safePage, totalPages, total } = paginatePatches(patches, page, UPDATE_LOG_PAGE_SIZE);
  const globalLatestId = patches[0]?.id;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain"
      onClick={onClose}
    >
      <div className={'absolute inset-0 modal-overlay ' + (closing ? 'holo-backdrop-out' : 'holo-backdrop-in')}/>
      <div
        className={
          'ul-modal relative w-full max-w-[min(96vw,640px)] my-auto ' +
          'glass-strong rounded-3xl border hairline overflow-hidden flex flex-col ' +
          (closing ? 'holo-card-out' : 'holo-card-in')
        }
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-labelledby="ul-modal-title"
        aria-modal="true"
      >
        <div className="ul-modal-header ul-mesh-purple relative flex items-center gap-2.5 px-4 py-3 shrink-0">
          <span className="ul-modal-header__icon shrink-0">
            <Icon name="file" size={16}/>
          </span>
          <div className="min-w-0 flex-1 relative z-[1]">
            <div id="ul-modal-title" className="font-semibold text-[16px] leading-tight text-white">
              รายการอัปเดต
            </div>
            <div className="text-[11px] text-white/80 mt-0.5">
              มีอะไรใหม่ในระบบ — อ่านง่ายๆ ไม่ต้องเดา
            </div>
          </div>
          <button type="button" className="pnb-iconbtn shrink-0 relative z-[1]" onClick={onClose} aria-label="ปิด">
            <Icon name="x" size={18}/>
          </button>
        </div>

        <div className="ul-modal-body px-4 py-3 bg-surface-cream-strong">
          {loading && !log && <LoadingSkeleton/>}

          {error && (
            <div className="ul-empty text-center py-8">
              <Icon name="alert" size={28} className="text-muted mx-auto mb-2"/>
              <p className="text-sm text-muted mb-3">โหลดบันทึกไม่ได้ — ลองใหม่</p>
              <button type="button" className="btn-secondary !text-xs" onClick={load}>
                <Icon name="refresh" size={14}/> ลองอีกครั้ง
              </button>
            </div>
          )}

          {!loading && !error && patches.length === 0 && (
            <div className="ul-empty text-center py-10 text-muted text-sm">
              ยังไม่มีบันทึกอัปเดต
            </div>
          )}

          {!error && items.length > 0 && (
            <div className="ul-card-list">
              {items.map(p => (
                <PatchCard
                  key={p.id}
                  patch={p}
                  isLatest={safePage === 1 && p.id === globalLatestId}
                />
              ))}
            </div>
          )}

          {!error && patches.length > 0 && (
            <UpdateLogPager
              page={safePage}
              totalPages={totalPages}
              total={total}
              onPageChange={setPage}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
