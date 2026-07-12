import { useCallback, useEffect, useState } from 'react';
import { sb } from '../lib/supabase-client.js';
import { TIKTOK_RETURN_CHANGED_EVENT } from '../lib/tiktok-stock-resolution.js';

/** Pending TikTok stock-resolution queue length — shared by header badge. */
export function usePendingTikTokReturnCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await sb.rpc('get_pending_tiktok_stock_resolutions', {
        p_limit: 200,
      });
      if (error) throw error;
      setCount(Array.isArray(data) ? data.length : 0);
    } catch {
      /* keep last known count on transient errors */
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener(TIKTOK_RETURN_CHANGED_EVENT, onChange);
    window.addEventListener('tiktok-pending-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(onChange, 60_000);
    return () => {
      window.removeEventListener(TIKTOK_RETURN_CHANGED_EVENT, onChange);
      window.removeEventListener('tiktok-pending-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(id);
    };
  }, [refresh]);

  return count;
}
