// Anchor "now" and "today" to Supabase server time so a cashier PC with a
// wrong clock doesn't skew dashboards or offline sale_date stamps.
//
// On boot (and when coming back online) we fetch Postgres now() once and
// cache the offset against Date.now(). Subsequent calls extrapolate without
// hitting the network on every tick.

import { dateISOBangkok } from './date.js';

let offsetMs = 0;
let synced = false;

/** Fetch Postgres now() and cache device↔server offset. Returns false on failure. */
export async function syncServerClock(sb) {
  if (!sb) return false;
  try {
    const { data, error } = await sb.rpc('get_server_now');
    if (error) throw error;
    const serverMs = new Date(data).getTime();
    if (!Number.isFinite(serverMs)) throw new Error('invalid server time');
    offsetMs = serverMs - Date.now();
    synced = true;
    return true;
  } catch (e) {
    synced = false;
    console.warn('[server-clock] sync failed — falling back to device clock', e);
    return false;
  }
}

export function isClockSynced() { return synced; }

/** Signed offset: server − device (ms). Null when never synced. */
export function clockDriftMs() { return synced ? offsetMs : null; }

/** Current instant aligned to server when synced, else device clock. */
export function serverNow() { return Date.now() + (synced ? offsetMs : 0); }

export function serverNowDate() { return new Date(serverNow()); }

/** Bangkok YYYY-MM-DD — prefers server clock when available. */
export function todayISO() {
  return dateISOBangkok(synced ? serverNowDate() : new Date());
}

/** ISO string for stamping offline sale_date at queue time. */
export function serverNowISO() {
  return serverNowDate().toISOString();
}
