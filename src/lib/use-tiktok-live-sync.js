// Live TikTok order mirror — Supabase Realtime + periodic TikTok API poll.
import { useCallback, useEffect, useRef, useState } from 'react';
import { sb } from './supabase-client.js';
import { pollTikTokOrders } from './tiktok-poll-sync.js';
import { useRealtimeInvalidate } from './use-realtime-invalidate.js';

/** Pull from TikTok API while the orders page is open (matches cron 5 min as backup). */
export const TIKTOK_LIVE_POLL_MS = 60_000;

export function useTikTokLiveSync({ enabled, onReload, onPulled }) {
  const [pullBusy, setPullBusy] = useState(false);
  const pullBusyRef = useRef(false);
  const pullQueueRef = useRef(Promise.resolve());
  const onReloadRef = useRef(onReload);
  const onPulledRef = useRef(onPulled);

  useEffect(() => { onReloadRef.current = onReload; }, [onReload]);
  useEffect(() => { onPulledRef.current = onPulled; }, [onPulled]);

  const pullFromTikTok = useCallback(async ({ queue = false } = {}) => {
    if (!enabled) return null;
    if (pullBusyRef.current && !queue) return null;

    const run = async () => {
      pullBusyRef.current = true;
      setPullBusy(true);
      try {
        const data = await pollTikTokOrders({ resync: true, hours: 720 });
        await onReloadRef.current?.();
        onPulledRef.current?.(data);
        return data;
      } finally {
        pullBusyRef.current = false;
        setPullBusy(false);
      }
    };

    const task = pullQueueRef.current.then(run, run);
    pullQueueRef.current = task.catch(() => {});
    return task;
  }, [enabled]);

  useRealtimeInvalidate(
    sb,
    ['sale_orders', 'sale_order_items'],
    () => onReloadRef.current?.(),
    { enabled, debounceMs: 400 },
  );

  useEffect(() => {
    if (!enabled) return undefined;
    pullFromTikTok();
    const id = setInterval(pullFromTikTok, TIKTOK_LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [enabled, pullFromTikTok]);

  return { pullFromTikTok, pullBusy, pullBusyRef };
}
