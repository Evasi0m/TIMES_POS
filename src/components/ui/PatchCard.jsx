import React from 'react';
import { formatPatchDate, patchTintTag } from '../../lib/update-log.js';

function tagClassName(tag) {
  if (tag === 'แก้บั๊ก' || tag === 'แก้ไข') return 'bug';
  if (tag === 'ปรับปรุง') return 'tweak';
  if (tag === 'ใหม่' || tag === 'ฟีเจอร์ใหม่' || tag === 'ฟีเจอร์') return 'new';
  return 'mod';
}

function PatchTag({ tag }) {
  return (
    <span className={'ul-tag ul-tag--' + tagClassName(tag)}>
      {tag}
    </span>
  );
}

export default function PatchCard({ patch, isLatest = false, compact = false }) {
  const tint = patchTintTag(patch.tags);
  return (
    <article
      className={
        'ul-card ttc-bento rounded-2xl border p-3 min-w-0 flex-none flex flex-col gap-2 min-h-0 ' +
        (isLatest ? 'ul-card--hero ul-mesh-card' : 'ul-card--' + tint + ' ul-mesh-card--soft') +
        (compact ? ' aug-patch-card--compact' : '')
      }
    >
      <div className="ul-card__top shrink-0">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            {isLatest && (
              <div className="ul-hero__label text-[10px] font-semibold uppercase tracking-wider mb-1">
                อัปเดตล่าสุด
              </div>
            )}
            <h3 className={'font-semibold text-ink leading-snug ' + (compact ? 'text-sm line-clamp-2' : 'text-sm line-clamp-2')}>
              {patch.title}
            </h3>
            <div className="text-[11px] text-muted tabular-nums mt-0.5">
              {formatPatchDate(patch.date)}
            </div>
          </div>
          <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[45%]">
            {(patch.tags || []).map((t) => (
              <PatchTag key={t} tag={t} />
            ))}
          </div>
        </div>
      </div>
      <div className={'ul-card__scroll min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-1 px-1' + (compact ? ' max-h-40' : '')}>
        <ul className="space-y-1.5 text-xs">
          {(patch.items || []).map((line, i) => (
            <li key={i} className="flex gap-2 text-ink/90 leading-relaxed">
              <span className="ul-bullet shrink-0" aria-hidden>•</span>
              <span className="min-w-0">{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
