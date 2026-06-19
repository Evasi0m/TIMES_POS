import { runtimeFetch } from './runtime-fetch.js';
// Source: src/data/updates.json → dist/updates.json at build time.

const LAST_SEEN_KEY = 'pos.updateLog.lastSeen';

const listeners = new Set();
let _cache = null;
let _unread = false;

function emit() {
  for (const cb of listeners) {
    try { cb({ unread: _unread, cache: _cache }); } catch { /* ignore */ }
  }
}

export function onUpdateLogChange(cb) {
  listeners.add(cb);
  try { cb({ unread: _unread, cache: _cache }); } catch { /* ignore */ }
  return () => listeners.delete(cb);
}

function getLastSeen() {
  try {
    return localStorage.getItem(LAST_SEEN_KEY) || '';
  } catch {
    return '';
  }
}

export function getLatestPatchId(log) {
  const patches = log?.patches;
  if (!Array.isArray(patches) || patches.length === 0) return null;
  return patches[0]?.id ?? null;
}

export function computeUnread(log) {
  const latest = getLatestPatchId(log);
  if (!latest) return false;
  return getLastSeen() !== latest;
}

export async function fetchUpdateLog() {
  const res = await runtimeFetch('updates.json');
  if (!res.ok) throw new Error(`updates.json HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Array.isArray(data.patches)) {
    throw new Error('updates.json invalid schema');
  }
  return data;
}

export async function refreshUpdateLogState() {
  try {
    const log = await fetchUpdateLog();
    _cache = log;
    _unread = computeUnread(log);
    emit();
    return { log, unread: _unread };
  } catch (e) {
    emit();
    throw e;
  }
}

export function hasUnreadUpdates() {
  return _unread;
}

export function markUpdatesSeen(log = _cache) {
  const latest = getLatestPatchId(log);
  if (!latest) return;
  try {
    localStorage.setItem(LAST_SEEN_KEY, latest);
  } catch { /* ignore */ }
  _unread = false;
  emit();
}

export function formatPatchDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Map first tag to card tint class suffix. */
export function patchTintTag(tags) {
  const t = (tags || [])[0] || '';
  if (t === 'แก้บั๊ก') return 'bug';
  if (t === 'ปรับปรุง') return 'tweak';
  return 'new';
}

export const UPDATE_LOG_PAGE_SIZE = 3;

/** Slice patches for pagination (page is 1-based). */
export function paginatePatches(patches, page, pageSize = UPDATE_LOG_PAGE_SIZE) {
  const list = patches || [];
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: list.slice(start, start + pageSize),
    page: safePage,
    totalPages,
    total,
    pageSize,
  };
}
