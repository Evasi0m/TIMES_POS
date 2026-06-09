import React from 'react';
import Icon from '../../ui/Icon.jsx';

export default function TikTokStatStrip({ cards = [] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {cards.map((s) => (
        <div
          key={s.label}
          className={
            'card-cream p-4 lg:p-5 hover-lift rounded-xl ' +
            (s.warn ? 'ring-1 ring-error/20' : '')
          }
        >
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="text-xs uppercase tracking-wider text-muted leading-tight">{s.label}</div>
            <Icon name={s.icon} size={16} className="text-muted-soft shrink-0"/>
          </div>
          <div className={'font-display text-3xl tabular-nums leading-none ' + (s.warn ? 'text-error' : 'text-ink')}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}
