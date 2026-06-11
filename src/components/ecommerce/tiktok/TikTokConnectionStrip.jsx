import React from 'react';
import TikTokSettings from '../../settings/TikTokSettings.jsx';

export default function TikTokConnectionStrip({ toast, livePollSec, liveLabel, pullBusy }) {
  return (
    <TikTokSettings
      toast={toast}
      livePollSec={livePollSec}
      liveLabel={liveLabel}
      pullBusy={pullBusy}
      compact
    />
  );
}
