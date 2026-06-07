import React from 'react';
import EcommerceBrandIcon from './EcommerceBrandIcon.jsx';

export default function ComingSoonPanel({ name, brand, note }) {
  return (
    <div className="card-canvas rounded-xl p-10 text-center max-w-lg mx-auto">
      {brand && (
        <EcommerceBrandIcon brand={brand} size={72} className="mx-auto mb-4 opacity-90"/>
      )}
      <h2 className="font-display text-xl mb-2">{name}</h2>
      <p className="text-muted text-sm">{note || 'เร็วๆ นี้'}</p>
    </div>
  );
}
