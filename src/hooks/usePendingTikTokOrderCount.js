import { useCallback, useEffect, useState } from 'react';
import { sb } from '../lib/supabase-client.js';

/** Pending TikTok confirm queue length � shared by Sidebar + header badge. */
export function usePendingTikTokOrderCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const { data, error } = await sb.rpc('get_pending_tiktok_orders', { p_limit: 200 });
      if (error) throw error;
      setCount(Array.isArray(data) ? data.length : 0);
    } catch {
      /* keep last known count on transient errors */
    }
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    window.addEventListener('tiktok-pending-changed', onChange);
    window.addEventListener('focus', onChange);
    const id = setInterval(onChange, 60_000);
    return () => {
      window.removeEventListener('tiktok-pending-changed', onChange);
      window.removeEventListener('focus', onChange);
      clearInterval(id);
    };
  }, [refresh]);

  return count;
}
