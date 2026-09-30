import React from 'react';
import Icon from './Icon.jsx';
import { pageItems } from '../../lib/pagination.js';

/** Prev · 1 … 4 5 6 … 12 · Next.  `page` is 0-based. */
export default function Pager({ page, count, onChange, className = '' }) {
  if (count <= 1) return null;
  const items = pageItems(page, count);
  return (
    <nav className={'pager ' + className} aria-label="เปลี่ยนหน้า">
      <button
        type="button"
        className="pager__btn pager__btn--nav"
        onClick={() => onChange(page - 1)}
        disabled={page <= 0}
        aria-label="หน้าก่อน"
      >
        <Icon name="chevron-l" size={16}/>
      </button>
      {items.map((it, i) => (it === 'gap'
        ? <span key={'g' + i} className="pager__gap" aria-hidden="true">…</span>
        : (
          <button
            key={it}
            type="button"
            className={'pager__btn tabular-nums' + (it === page ? ' is-active' : '')}
            onClick={() => onChange(it)}
            aria-current={it === page ? 'page' : undefined}
            aria-label={`หน้า ${it + 1}`}
          >
            {it + 1}
          </button>
        )))}
      <button
        type="button"
        className="pager__btn pager__btn--nav"
        onClick={() => onChange(page + 1)}
        disabled={page >= count - 1}
        aria-label="หน้าถัดไป"
      >
        <Icon name="chevron-r" size={16}/>
      </button>
    </nav>
  );
}
