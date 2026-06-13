import React from 'react';

/** Single row under mobile top bar — context left, icon actions right. */
export default function MobilePageBand({ children, actions, className = '' }) {
  return (
    <div className={'lg:hidden flex items-center justify-between gap-2 px-4 py-2 border-b hairline bg-canvas/80 backdrop-blur-sm ' + className}>
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex items-center gap-1 shrink-0">{actions}</div> : null}
    </div>
  );
}
