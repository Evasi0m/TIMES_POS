// AI settings — master switch + multi-key pool manager + usage summary.
//
// Replaces the v1 single-key form with a priority-ordered pool of Gemini
// API keys (migration 016). The Edge Function (cmg-bill-parse v6+)
// cascades through these keys when one runs out of quota, so admins can
// register personal + backup keys and never have a "shop dead until
// midnight PT" day again.
//
// What each section does:
//   1. Master switch         → shop_secrets.ai_bill_scan_enabled.
//                              A quick kill switch that hides the whole
//                              AI scan button in Stock-In without having
//                              to delete the key pool.
//   2. Key pool               → ai_api_keys rows.
//                              - Cards listed by priority ASC.
//                              - Per-card: label (inline-edit), masked
//                                key (not editable after create — delete
//                                and re-add to rotate a key), RPD bar
//                                (count from ai_usage_log today ÷ limit),
//                                disabled toggle, priority up/down,
//                                delete button, last_used relative time,
//                                last_error banner.
//                              - "+ เพิ่ม API key" button expands an
//                                inline form with label + key fields.
//   3. Usage summary          → rolling 30-day totals from ai_usage_log.
//                              Unchanged from v1.
//
// Security notes:
//   - `api_key` column is admin-only via RLS; cashiers get 0 rows and
//     the whole page guard in main.jsx hides the tab anyway.
//   - We mask the key as `AIza…••…suffix` in the UI. The full value is
//     only sent over the wire on initial GET (admin-only) and on create.
//   - We never log the key server-side or in console.error.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import Icon from '../ui/Icon.jsx';

// ─── Helpers ─────────────────────────────────────────────────────────

// Mask a key as `AIza...••••••••aB12` so the card shows something
// recognizable but doesn't paste-bomb the full secret into the DOM.
// Short keys (< 12 chars) are hidden entirely — probably a typo anyway.
function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length < 12) return '••••••••';
  return s.slice(0, 4) + '…' + '•'.repeat(8) + s.slice(-4);
}

// Relative-time formatter — "2 นาทีที่แล้ว" / "3 ชั่วโมงที่แล้ว" /
// "เมื่อวาน" / "3 วันก่อน". Falls back to locale date for > 7 days.
function relativeTime(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return 'เพิ่งใช้';
  const min = Math.floor(diffMs / 60_000);
  if (min < 1)  return 'เพิ่งใช้';
  if (min < 60) return `${min} นาทีที่แล้ว`;
  const hr = Math.floor(min / 60);
  if (hr < 24)  return `${hr} ชั่วโมงที่แล้ว`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'เมื่อวาน';
  if (day <= 7)  return `${day} วันก่อน`;
  return new Date(iso).toLocaleDateString('th-TH');
}

// Compute today-UTC boundary in ISO — we count RPD against the Google
// quota reset schedule (midnight Pacific Time ≈ UTC morning), so using
// the user's local midnight would mis-bucket. "Today in UTC" is close
// enough to Google's reset for a cosmetic progress bar.
function todayUtcStartIso() {
  const now = new Date();
  const utc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()
  ));
  return utc.toISOString();
}

// ─── Component ───────────────────────────────────────────────────────
export default function AISettings({ toast }) {
  const [masterOn, setMasterOn]     = useState(false);
  const [keys, setKeys]             = useState([]);
  const [usageByKey, setUsageByKey] = useState({}); // id → count today (ok=true)
  const [usageSummary, setUsageSummary] = useState({ calls: 0, tokens: 0, thb: 0 });
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState(null);

  // ─── Load all three data sources in parallel ─────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [secretsRes, keysRes, usageRes, sumRes] = await Promise.all([
        sb.from('shop_secrets').select('ai_bill_scan_enabled').eq('id', 1).maybeSingle(),
        sb.from('ai_api_keys')
          .select('id, label, api_key, priority, disabled, rpd_limit, last_used_at, last_error, last_error_at, created_at')
          .order('priority', { ascending: true })
          .order('created_at', { ascending: true }),
        // Count today's successful calls per key — used for the RPD
        // progress bar. We filter ok=true so failed attempts (quota
        // errors that fell through to another key) don't inflate the
        // number. The unique index on (api_key_id, created_at) WHERE
        // ok=true makes this a cheap index-only scan.
        sb.from('ai_usage_log')
          .select('api_key_id')
          .eq('ok', true)
          .gte('created_at', todayUtcStartIso()),
        // 30-day rollup for the usage summary card. Matches the prior
        // UI's behavior — unchanged from v1.
        sb.from('ai_usage_log')
          .select('total_tokens, estimated_thb')
          .eq('ok', true)
          .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
      ]);

      if (secretsRes.error) throw secretsRes.error;
      if (keysRes.error)    throw keysRes.error;
      // Usage queries are advisory — we don't want a broken index to
      // break the whole settings page. Log and fall back to empty.
      if (usageRes.error) {
        console.warn('[AISettings] RPD count failed:', usageRes.error);
      }
      if (sumRes.error) {
        console.warn('[AISettings] usage rollup failed:', sumRes.error);
      }

      setMasterOn(Boolean(secretsRes.data?.ai_bill_scan_enabled));
      setKeys(keysRes.data || []);

      const byKey = {};
      (usageRes.data || []).forEach((r) => {
        if (!r.api_key_id) return;
        byKey[r.api_key_id] = (byKey[r.api_key_id] || 0) + 1;
      });
      setUsageByKey(byKey);

      const sumRows = sumRes.data || [];
      setUsageSummary({
        calls: sumRows.length,
        tokens: sumRows.reduce((s, r) => s + (Number(r.total_tokens) || 0), 0),
        thb:    sumRows.reduce((s, r) => s + (Number(r.estimated_thb) || 0), 0),
      });
    } catch (e) {
      setError(mapError(e) || e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ─── Master switch toggle ────────────────────────────────────────
  const toggleMaster = async () => {
    if (busy) return;
    setBusy(true);
    const next = !masterOn;
    setMasterOn(next); // optimistic
    try {
      const { error: e } = await sb.from('shop_secrets')
        .update({ ai_bill_scan_enabled: next })
        .eq('id', 1);
      if (e) throw e;
      toast?.({
        variant: next ? 'success' : 'info',
        text: next ? 'เปิดใช้งาน AI scan แล้ว' : 'ปิดการใช้งาน AI scan แล้ว',
      });
    } catch (e) {
      setMasterOn(!next); // revert
      toast?.({ variant: 'error', text: 'บันทึกไม่สำเร็จ: ' + (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  // ─── Key CRUD ─────────────────────────────────────────────────────
  const addKey = async ({ label, apiKey }) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) throw new Error('API key ว่าง');
    // Google's Gemini keys start with "AIza" and are 39 chars — a soft
    // check to catch obvious paste mistakes (extra whitespace, wrong
    // column copied). We don't block non-matching input; Google's
    // auth will reject them on first use which stamps last_error.
    if (!trimmedKey.startsWith('AIza') || trimmedKey.length < 35) {
      const proceed = window.confirm(
        'คีย์นี้ดูไม่เหมือน Gemini API key (ปกติขึ้นต้นด้วย "AIza" และยาว ~39 ตัว) — เพิ่มต่อไปหรือไม่?'
      );
      if (!proceed) throw new Error('ยกเลิก');
    }
    // New keys go to the back — priority = max(existing) + 1 so they
    // act as backups by default, not accidentally jumping the primary.
    const maxPri = keys.reduce((mx, k) => Math.max(mx, k.priority), -1);
    const { error: e } = await sb.from('ai_api_keys').insert({
      label:    label.trim() || 'Unlabeled',
      api_key:  trimmedKey,
      priority: maxPri + 1,
    });
    if (e) throw e;
    await loadAll();
  };

  const deleteKey = async (id, label) => {
    if (!window.confirm(`ลบ API key "${label || 'Unlabeled'}" ถาวร?`)) return;
    setBusy(true);
    try {
      const { error: e } = await sb.from('ai_api_keys').delete().eq('id', id);
      if (e) throw e;
      toast?.({ variant: 'success', text: 'ลบ API key แล้ว' });
      await loadAll();
    } catch (e) {
      toast?.({ variant: 'error', text: 'ลบไม่สำเร็จ: ' + (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  const toggleDisabled = async (id, currentDisabled) => {
    setBusy(true);
    try {
      const { error: e } = await sb.from('ai_api_keys')
        .update({ disabled: !currentDisabled })
        .eq('id', id);
      if (e) throw e;
      await loadAll();
    } catch (e) {
      toast?.({ variant: 'error', text: (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  const updateLabel = async (id, newLabel) => {
    setBusy(true);
    try {
      const { error: e } = await sb.from('ai_api_keys')
        .update({ label: newLabel.trim() || 'Unlabeled' })
        .eq('id', id);
      if (e) throw e;
      await loadAll();
    } catch (e) {
      toast?.({ variant: 'error', text: (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  const updateRpdLimit = async (id, newLimit) => {
    const n = Math.max(1, Math.min(100_000, Math.round(Number(newLimit) || 250)));
    setBusy(true);
    try {
      const { error: e } = await sb.from('ai_api_keys')
        .update({ rpd_limit: n })
        .eq('id', id);
      if (e) throw e;
      await loadAll();
    } catch (e) {
      toast?.({ variant: 'error', text: (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  // Move priority up/down. Simpler than sortable-drag — swap the moved
  // key's priority with the neighbor's. The unique priority column is
  // not enforced by schema (ties are allowed), so collisions aren't a
  // concern; we just renumber both rows in a single round-trip each.
  const movePriority = async (index, dir) => {
    const other = dir === 'up' ? index - 1 : index + 1;
    if (other < 0 || other >= keys.length) return;
    const a = keys[index];
    const b = keys[other];
    setBusy(true);
    try {
      // Two sequential updates rather than one upsert — the rows may
      // have identical priority, in which case we need to break the tie
      // with a forced 2-apart gap. Giving each a distinct new number
      // (b.priority, a.priority) is enough.
      const tempHigh = Math.max(a.priority, b.priority) + 1;
      // Use a high temp value for one row first to avoid any unique
      // constraint tripping if we add one later. Cheap insurance.
      await sb.from('ai_api_keys').update({ priority: tempHigh }).eq('id', a.id);
      await sb.from('ai_api_keys').update({ priority: a.priority }).eq('id', b.id);
      await sb.from('ai_api_keys').update({ priority: b.priority }).eq('id', a.id);
      await loadAll();
    } catch (e) {
      toast?.({ variant: 'error', text: (mapError(e) || e?.message || 'unknown') });
    } finally {
      setBusy(false);
    }
  };

  // ─── Derived: global daily spend projection ──────────────────────
  const totalToday = useMemo(
    () => Object.values(usageByKey).reduce((s, n) => s + n, 0),
    [usageByKey],
  );
  const totalRpdCap = useMemo(
    () => keys.filter((k) => !k.disabled).reduce((s, k) => s + k.rpd_limit, 0),
    [keys],
  );

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="font-display text-2xl flex items-center gap-2">
          <Icon name="scan" size={22} className="text-primary"/>
          AI — สแกนบิล CMG
        </h2>
        <p className="text-sm text-muted-soft">
          ระบบ AI อ่านบิลอัตโนมัติผ่าน Google Gemini — รองรับใส่ API key หลายตัว,
          เมื่อ key หนึ่งเต็มโควต้าจะสลับไป key ถัดไปอัตโนมัติ
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="card-canvas p-3 bg-error/5 border-error/30 flex items-center gap-2 text-sm text-error">
          <Icon name="alert" size={16}/> {error}
          <button type="button" className="ml-auto btn-ghost !py-1 !text-xs" onClick={loadAll}>
            ลองใหม่
          </button>
        </div>
      )}

      {/* ── Section 1: Master switch ── */}
      <div className="card-canvas overflow-hidden">
        <div className="p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="font-semibold">เปิดใช้งาน AI scan</div>
            <div className="text-xs text-muted-soft mt-0.5">
              ปิดเพื่อซ่อนปุ่ม "สแกนบิล AI" ในหน้ารับเข้าโดยไม่ต้องลบ key
            </div>
          </div>
          <ToggleSwitch checked={masterOn} onChange={toggleMaster} disabled={busy || loading}/>
        </div>
      </div>

      {/* ── Section 2: Key pool ── */}
      <div className="card-canvas overflow-hidden">
        <div className="p-4 border-b hairline flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold flex items-center gap-2">
              <Icon name="lock" size={16}/>
              API keys ({keys.length})
            </div>
            {keys.length > 0 && (
              <div className="text-xs text-muted-soft mt-0.5 tabular-nums">
                วันนี้ใช้ไป {totalToday} / {totalRpdCap} ครั้ง (รวมทุก key ที่เปิดอยู่)
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={loadAll}
            disabled={loading || busy}
            title="รีเฟรชสถานะ"
          >
            <Icon name="refresh" size={14} className={loading ? 'animate-spin' : ''}/>
            รีเฟรช
          </button>
        </div>

        <div className="divide-y hairline">
          {loading && keys.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-soft">กำลังโหลด…</div>
          )}

          {!loading && keys.length === 0 && (
            <div className="p-8 text-center text-sm text-muted-soft">
              ยังไม่มี API key — กดปุ่มด้านล่างเพื่อเพิ่ม
            </div>
          )}

          {keys.map((k, i) => (
            <KeyCard
              key={k.id}
              k={k}
              index={i}
              total={keys.length}
              usageToday={usageByKey[k.id] || 0}
              busy={busy}
              onMoveUp={()    => movePriority(i, 'up')}
              onMoveDown={()  => movePriority(i, 'down')}
              onToggle={()    => toggleDisabled(k.id, k.disabled)}
              onRename={(v)   => updateLabel(k.id, v)}
              onSetLimit={(v) => updateRpdLimit(k.id, v)}
              onDelete={()    => deleteKey(k.id, k.label)}
            />
          ))}
        </div>

        <div className="p-4 border-t hairline">
          <AddKeyForm onSubmit={addKey} onToast={toast} busy={busy}/>
        </div>
      </div>

      {/* ── Section 3: 30-day usage summary ── */}
      <div className="card-canvas overflow-hidden">
        <div className="p-4 border-b hairline font-semibold flex items-center gap-2">
          <Icon name="trend-up" size={16}/>
          สรุปการใช้งาน 30 วันล่าสุด
        </div>
        <div className="p-4 grid grid-cols-3 gap-4 text-center">
          <SummaryStat label="เรียกสำเร็จ"  value={usageSummary.calls.toLocaleString()} unit="ครั้ง"/>
          <SummaryStat label="Total tokens" value={usageSummary.tokens.toLocaleString()} unit="tokens"/>
          <SummaryStat label="ค่าใช้จ่าย"   value={`฿${usageSummary.thb.toFixed(2)}`}     unit="(ประมาณ)"/>
        </div>
      </div>
    </div>
  );
}

// ─── Sub: per-key card ───────────────────────────────────────────────
function KeyCard({
  k, index, total, usageToday, busy,
  onMoveUp, onMoveDown, onToggle, onRename, onSetLimit, onDelete,
}) {
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(k.label || '');
  const [editingLimit, setEditingLimit] = useState(false);
  const [limitDraft, setLimitDraft]     = useState(String(k.rpd_limit));

  // Keep draft in sync when parent re-fetches after a save — otherwise
  // the input reverts to stale local state on re-open.
  useEffect(() => { setDraft(k.label || ''); },        [k.label]);
  useEffect(() => { setLimitDraft(String(k.rpd_limit)); }, [k.rpd_limit]);

  const pct = Math.min(100, Math.round((usageToday / Math.max(1, k.rpd_limit)) * 100));
  const barColor =
    pct >= 90 ? 'bg-error'   :
    pct >= 70 ? 'bg-warning' :
                'bg-success';

  const saveLabel = () => {
    setEditing(false);
    if (draft.trim() !== (k.label || '').trim()) onRename(draft);
  };
  const saveLimit = () => {
    setEditingLimit(false);
    const n = Math.max(1, Math.round(Number(limitDraft) || 250));
    if (n !== k.rpd_limit) onSetLimit(n);
  };

  return (
    <div className={'p-4 space-y-3 transition-colors ' + (k.disabled ? 'opacity-60 bg-surface-soft' : '')}>
      {/* Row 1: label + state chips + action buttons */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-shrink-0 ai-row-badge w-7 h-7 !text-xs tabular-nums">{index + 1}</div>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              autoFocus
              className="input !py-1 !px-2 !text-sm !min-h-0 w-full max-w-xs"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLabel();
                if (e.key === 'Escape') { setDraft(k.label || ''); setEditing(false); }
              }}
              maxLength={60}
            />
          ) : (
            <button
              type="button"
              className="font-semibold text-left hover:text-primary transition-colors inline-flex items-center gap-1.5"
              onClick={() => setEditing(true)}
              title="คลิกเพื่อเปลี่ยนชื่อ"
            >
              {k.label || 'Unlabeled'}
              <Icon name="edit" size={11} className="text-muted-soft"/>
            </button>
          )}
          <div className="text-xs text-muted-soft font-mono mt-0.5">{maskKey(k.api_key)}</div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button" className="btn-ghost !p-1.5"
            title="เลื่อนขึ้น (priority สูงขึ้น)"
            disabled={busy || index === 0}
            onClick={onMoveUp}
          ><Icon name="chevron-u" size={14}/></button>
          <button
            type="button" className="btn-ghost !p-1.5"
            title="เลื่อนลง"
            disabled={busy || index === total - 1}
            onClick={onMoveDown}
          ><Icon name="chevron-d" size={14}/></button>
          <ToggleSwitch
            checked={!k.disabled}
            onChange={onToggle}
            disabled={busy}
            size="sm"
          />
          <button
            type="button" className="btn-ghost !p-1.5 text-error"
            title="ลบ key นี้"
            disabled={busy}
            onClick={onDelete}
          ><Icon name="trash" size={14}/></button>
        </div>
      </div>

      {/* Row 2: RPD progress bar */}
      <div>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-soft">RPD วันนี้</span>
          <span className="tabular-nums font-mono">
            <span className={pct >= 90 ? 'text-error font-semibold' : pct >= 70 ? 'text-warning font-semibold' : ''}>
              {usageToday}
            </span>
            <span className="text-muted-soft"> / </span>
            {editingLimit ? (
              <input
                type="number"
                autoFocus
                className="input !py-0 !px-1 !text-xs !min-h-0 w-16 inline-block text-right"
                value={limitDraft}
                onChange={(e) => setLimitDraft(e.target.value)}
                onBlur={saveLimit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveLimit();
                  if (e.key === 'Escape') { setLimitDraft(String(k.rpd_limit)); setEditingLimit(false); }
                }}
                min="1"
                max="100000"
              />
            ) : (
              <button
                type="button"
                className="hover:text-primary transition-colors inline-flex items-center gap-0.5"
                onClick={() => setEditingLimit(true)}
                title="แก้ลิมิตแสดงผล (ไม่มีผลต่อโควต้าจริงของ Google)"
              >
                {k.rpd_limit}
                <Icon name="edit" size={10} className="text-muted-soft"/>
              </button>
            )}
          </span>
        </div>
        <div className="h-1.5 bg-surface-soft rounded-full overflow-hidden mt-1">
          <div
            className={'h-full transition-all ' + barColor}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Row 3: status chips — last_used / last_error */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {k.last_used_at && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-success/10 border border-success/30 text-success">
            <Icon name="check" size={11}/>
            ใช้งานล่าสุด: {relativeTime(k.last_used_at)}
          </span>
        )}
        {!k.last_used_at && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-soft text-muted-soft border hairline">
            ยังไม่เคยถูกใช้
          </span>
        )}
        {k.last_error && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-warning/10 border border-warning/30 text-warning" title={k.last_error_at || ''}>
            <Icon name="alert" size={11}/>
            {k.last_error}
            {k.last_error_at && <span className="text-muted-soft"> · {relativeTime(k.last_error_at)}</span>}
          </span>
        )}
        {k.disabled && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-soft text-muted-soft border hairline">
            <Icon name="x" size={11}/> ปิดใช้งาน
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Sub: add-key form ───────────────────────────────────────────────
function AddKeyForm({ onSubmit, onToast, busy }) {
  const [open, setOpen]   = useState(false);
  const [label, setLabel] = useState('');
  const [key, setKey]     = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!key.trim()) {
      onToast?.({ variant: 'error', text: 'ต้องกรอก API key' });
      return;
    }
    setSaving(true);
    try {
      await onSubmit({ label, apiKey: key });
      onToast?.({ variant: 'success', text: 'เพิ่ม API key แล้ว' });
      setLabel('');
      setKey('');
      setOpen(false);
    } catch (e) {
      if (e?.message !== 'ยกเลิก') {
        onToast?.({ variant: 'error', text: 'เพิ่มไม่สำเร็จ: ' + (mapError(e) || e?.message || 'unknown') });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="btn-ghost w-full justify-center text-sm"
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        <Icon name="plus" size={14}/>
        เพิ่ม API key
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-soft flex items-start gap-1.5">
        <Icon name="alert" size={12} className="mt-0.5"/>
        <span>
          ขอ Gemini API key ฟรีได้ที่ <span className="font-mono">aistudio.google.com/apikey</span> —
          key จะขึ้นต้นด้วย "AIza" ยาวประมาณ 39 ตัว
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          className="input !py-2 !text-sm sm:col-span-1"
          placeholder="ชื่อ (เช่น เบอร์หลัก)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          disabled={saving}
        />
        <input
          type="password"
          className="input !py-2 !text-sm font-mono sm:col-span-2"
          placeholder="AIza..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoComplete="off"
          disabled={saving}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          className="btn-ghost text-sm"
          onClick={() => { setOpen(false); setLabel(''); setKey(''); }}
          disabled={saving}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          className="btn-primary text-sm"
          onClick={submit}
          disabled={saving || !key.trim()}
        >
          {saving ? (
            <><Icon name="refresh" size={14} className="animate-spin"/> กำลังบันทึก…</>
          ) : (
            <><Icon name="check" size={14}/> เพิ่ม key</>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Sub: toggle switch (iOS style) ──────────────────────────────────
function ToggleSwitch({ checked, onChange, disabled, size = 'md' }) {
  const cls = size === 'sm'
    ? 'w-9 h-5 after:w-3.5 after:h-3.5 after:top-[3px] after:left-[3px]'
    : 'w-11 h-6 after:w-4 after:h-4 after:top-1 after:left-1';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={
        'relative rounded-full transition-colors flex-shrink-0 ' +
        cls + ' ' +
        (checked ? 'bg-primary' : 'bg-surface-soft border hairline') + ' ' +
        (disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer') +
        ' after:content-[""] after:absolute after:bg-white after:rounded-full after:shadow after:transition-transform ' +
        (checked ? (size === 'sm' ? 'after:translate-x-4' : 'after:translate-x-5') : '')
      }
    />
  );
}

// ─── Sub: summary stat card ──────────────────────────────────────────
function SummaryStat({ label, value, unit }) {
  return (
    <div>
      <div className="text-xs text-muted-soft">{label}</div>
      <div className="text-2xl font-display tabular-nums mt-0.5">{value}</div>
      <div className="text-[10px] text-muted-soft">{unit}</div>
    </div>
  );
}
