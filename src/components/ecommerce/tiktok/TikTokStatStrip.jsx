import React from 'react';
import { TikTokGlassStat } from './glass/index.js';

export default function TikTokStatStrip({ cards = [] }) {
  return (
    <div className="tt-glass__stat-grid tt-glass__stat-grid--bento">
      {cards.map((s, idx) => (
        <TikTokGlassStat
          key={s.label}
          icon={s.icon}
          label={s.label}
          value={s.value}
          warn={s.warn}
          className={idx === 0 ? 'tt-glass__stat--primary' : ''}
        />
      ))}
    </div>
  );
}
