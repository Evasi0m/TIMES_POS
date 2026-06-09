import React, { useMemo } from 'react';
import Icon from '../../ui/Icon.jsx';

const PAGE_SIZES = [20, 50, 100];

/** Page number buttons — show window around current page. */
function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('…');
    out.push(sorted[i]);
  }
  return out;
}

export default function TikTokListPagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  const nums = useMemo(() => pageNumbers(safePage, totalPages), [safePage, totalPages]);

  if (total === 0) return null;

  return (
    <div className="px-4 py-3 border-t hairline bg-surface-soft/40 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-soft shrink-0">แสดง</span>
          <select
            className="input !h-9 !min-h-9 !py-0 !px-2 !text-xs !w-auto tabular-nums"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="จำนวนรายการต่อหน้า"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <span className="text-muted-soft shrink-0">รายการ/หน้า</span>
        </label>
        <span className="text-muted-soft hidden sm:inline">·</span>
        <span className="tabular-nums">
          {from.toLocaleString('th-TH')}–{to.toLocaleString('th-TH')} จาก {total.toLocaleString('th-TH')}
        </span>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center gap-1 sm:ml-auto">
          <button
            type="button"
            className="btn-ghost !py-1.5 !px-2.5 !min-h-[36px]"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="หน้าก่อน"
          >
            <Icon name="chevron-r" size={16} className="rotate-180"/>
          </button>
          {nums.map((n, i) => (
            typeof n === 'number' ? (
              <button
                key={n}
                type="button"
                className={
                  'min-w-[36px] h-9 px-2 rounded-lg text-xs font-medium tabular-nums transition ' +
                  (n === safePage
                    ? 'bg-surface-strong text-ink shadow-sm ring-1 ring-hairline'
                    : 'text-muted hover:text-ink hover:bg-surface-strong/50')
                }
                onClick={() => onPageChange(n)}
              >
                {n}
              </button>
            ) : (
              <span key={`gap-${i}`} className="px-1 text-muted-soft text-xs">…</span>
            )
          ))}
          <button
            type="button"
            className="btn-ghost !py-1.5 !px-2.5 !min-h-[36px]"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="หน้าถัดไป"
          >
            <Icon name="chevron-r" size={16}/>
          </button>
        </div>
      )}
    </div>
  );
}

export { PAGE_SIZES };
