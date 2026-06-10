import React from 'react';
import { TikTokGlassStat } from './glass/index.js';

export default function TikTokStatStrip({ cards = [] }) {
  return (
    <div className="tt-glass__stat-grid">
      {cards.map((s) => (
        <TikTokGlassStat
          key={s.label}
          icon={s.icon}
          label={s.label}
          value={s.value}
          warn={s.warn}
        />
      ))}
    </div>
  );
}
