import React from 'react';
import TikTokConfirmPanel from './TikTokConfirmPanel.jsx';
import TikTokReturnPanel from './TikTokReturnPanel.jsx';

/** POS header badges — TikTok confirm + return resolution queues. */
export default function TikTokPosBadges({ toast, onConfirmed }) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      <TikTokConfirmPanel toast={toast} onConfirmed={onConfirmed} />
      <TikTokReturnPanel toast={toast} />
    </div>
  );
}
