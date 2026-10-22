// Super-admin editor for per-role permissions ("สิทธิ์ตามบทบาท").
// Reads / writes public.role_permissions through set_role_permissions()
// (migration 086). super_admin itself is always "everything" and not editable.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { sb } from '../../lib/supabase-client.js';
import { mapError } from '../../lib/error-map.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  EDITABLE_ROLES,
  PERMISSION_GROUPS,
  ROLE_META,
  groupsMissingView,
  normalizePermissions,
} from '../../lib/permissions.js';
import Icon from '../ui/Icon.jsx';

function Switch({ checked, onChange, disabled, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors '
        + (checked ? 'bg-primary' : 'bg-surface-strong border hairline')
        + (disabled ? ' opacity-50' : '')
      }
    >
      <span
        className={
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform '
          + (checked ? 'translate-x-[22px]' : 'translate-x-[2px]')
        }
      />
    </button>
  );
}

export default function RolePermissionsEditor({ toast, askConfirm }) {
  const [role, setRole] = useState('staff');
  const [stored, setStored] = useState({});       // role -> normalized perms from DB
  const [draft, setDraft] = useState(null);       // perms being edited for `role`
  const [meta, setMeta] = useState({});           // role -> { updated_at, updated_by_email }
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await sb.from('role_permissions')
      .select('role, permissions, updated_at, updated_by_email');
    setLoading(false);
    if (error) {
      setLoadError(mapError(error));
      return;
    }
    const next = {};
    const nextMeta = {};
    for (const r of EDITABLE_ROLES) {
      const row = (data || []).find(x => x.role === r);
      next[r] = normalizePermissions(row?.permissions ?? DEFAULT_ROLE_PERMISSIONS[r]);
      nextMeta[r] = row ? { updated_at: row.updated_at, updated_by_email: row.updated_by_email } : null;
    }
    setStored(next);
    setMeta(nextMeta);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (stored[role]) setDraft({ ...stored[role] });
  }, [role, stored]);

  const dirty = useMemo(() => {
    if (!draft || !stored[role]) return false;
    return Object.keys(draft).some(k => draft[k] !== stored[role][k]);
  }, [draft, stored, role]);

  const missingView = useMemo(() => new Set(draft ? groupsMissingView(draft) : []), [draft]);
  const enabledCount = draft ? Object.values(draft).filter(Boolean).length : 0;
  const totalCount = draft ? Object.keys(draft).length : 0;

  const switchRole = async (next) => {
    if (next === role) return;
    if (dirty) {
      const ok = await askConfirm?.({
        title: 'ยังไม่ได้บันทึก',
        message: `สิทธิ์ของ ${ROLE_META[role].label} ที่แก้ไว้จะหายไป — เปลี่ยน role เลยไหม`,
        okLabel: 'ทิ้งการแก้ไข',
        danger: true,
      });
      if (!ok) return;
    }
    setRole(next);
  };

  const setKey = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  const setGroup = (group, value) => setDraft(d => {
    const n = { ...d };
    for (const p of group.perms) n[p.key] = value;
    if (value && group.viewKey) n[group.viewKey] = true;
    return n;
  });

  const resetDefaults = () => {
    setDraft(normalizePermissions(DEFAULT_ROLE_PERMISSIONS[role]));
    toast?.push('คืนค่าเริ่มต้นแล้ว — กดบันทึกเพื่อยืนยัน', 'info');
  };

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    const { error } = await sb.rpc('set_role_permissions', { p_role: role, p_permissions: draft });
    setSaving(false);
    if (error) {
      toast?.push('บันทึกสิทธิ์ไม่สำเร็จ: ' + mapError(error), 'error');
      return;
    }
    toast?.push(`บันทึกสิทธิ์ของ ${ROLE_META[role].label} แล้ว`, 'success');
    await load();
  };

  if (loadError) {
    return (
      <div className="rounded-xl border hairline p-4 text-sm">
        <div className="font-medium text-error mb-1">โหลดสิทธิ์ไม่ได้</div>
        <div className="text-muted">{loadError}</div>
        <div className="text-[11px] text-muted-soft mt-2">
          ถ้ายังไม่ได้รัน migration 086_role_permissions.sql ให้รันใน Supabase SQL Editor ก่อน
        </div>
        <button className="btn-secondary !py-1.5 !px-3 !text-sm mt-3" onClick={load}>ลองใหม่</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Role picker */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="text-left rounded-lg border hairline p-3 bg-surface-soft opacity-80" title="Super Admin ทำได้ทุกอย่างเสมอ">
          <div className={'font-medium text-sm flex items-center gap-1.5 ' + ROLE_META.super_admin.tone}>
            <Icon name="crown" size={14}/> {ROLE_META.super_admin.label}
          </div>
          <div className="text-[11px] text-muted-soft leading-snug mt-0.5">ทุกสิทธิ์ · แก้ไขไม่ได้</div>
        </div>
        {EDITABLE_ROLES.map(r => {
          const active = r === role;
          const count = stored[r] ? Object.values(stored[r]).filter(Boolean).length : null;
          return (
            <button
              key={r}
              type="button"
              onClick={() => switchRole(r)}
              className={
                'text-left rounded-lg border p-3 transition '
                + (active
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-hairline hover:border-ink/20 hover:bg-surface-strong/40')
              }
            >
              <div className={'font-medium text-sm ' + ROLE_META[r].tone}>{ROLE_META[r].label}</div>
              <div className="text-[11px] text-muted-soft leading-snug mt-0.5">
                {count == null ? '…' : `เปิด ${count} สิทธิ์`}
              </div>
            </button>
          );
        })}
      </div>

      {loading && !draft && (
        <div className="p-6 text-sm text-muted flex items-center gap-2 justify-center">
          <span className="spinner"/> กำลังโหลดสิทธิ์…
        </div>
      )}

      {draft && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm text-muted">
              <span className="text-ink font-medium">{ROLE_META[role].label}</span>
              {' · '}เปิด {enabledCount}/{totalCount}
              {meta[role]?.updated_at && (
                <span className="text-[11px] text-muted-soft block sm:inline sm:ml-2">
                  แก้ล่าสุด {new Date(meta[role].updated_at).toLocaleString('th-TH')}
                  {meta[role].updated_by_email ? ` · ${meta[role].updated_by_email}` : ''}
                </span>
              )}
            </div>
            <button type="button" className="btn-ghost !py-1.5 !px-2.5 !text-xs" onClick={resetDefaults} disabled={saving}>
              <Icon name="refresh" size={14}/> คืนค่าเริ่มต้น
            </button>
          </div>

          <div className="space-y-3">
            {PERMISSION_GROUPS.map(group => {
              const allOn = group.perms.every(p => draft[p.key]);
              const warn = missingView.has(group.id);
              return (
                <section key={group.id} className="rounded-xl border hairline overflow-hidden">
                  <header className="flex items-center justify-between gap-2 px-3.5 py-2.5 bg-surface-soft border-b hairline">
                    <div className="text-xs uppercase tracking-wider text-muted font-medium">{group.label}</div>
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline"
                      onClick={() => setGroup(group, !allOn)}
                      disabled={saving}
                    >
                      {allOn ? 'ปิดทั้งหมด' : 'เปิดทั้งหมด'}
                    </button>
                  </header>
                  {warn && (
                    <div className="px-3.5 py-2 text-[11px] text-warning bg-warning/10 flex items-start gap-1.5">
                      <Icon name="alert" size={12} className="shrink-0 mt-0.5"/>
                      <span>ยังไม่ได้เปิดหน้านี้ในกลุ่ม "หน้าที่เข้าได้" — สิทธิ์ในกลุ่มนี้จะใช้ไม่ได้</span>
                    </div>
                  )}
                  <div className="divide-y divide-hairline">
                    {group.perms.map(p => (
                      <label key={p.key} className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-ink">{p.label}</div>
                          {p.hint && <div className="text-[11px] text-muted-soft leading-snug mt-0.5">{p.hint}</div>}
                        </div>
                        <Switch
                          checked={!!draft[p.key]}
                          onChange={(v) => setKey(p.key, v)}
                          disabled={saving}
                          label={p.label}
                        />
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-canvas/95 backdrop-blur border-t hairline flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-muted-soft leading-snug max-w-md">
              มีผลทันทีหลังบันทึก — ผู้ใช้ที่เปิดแอปอยู่จะได้สิทธิ์ใหม่เมื่อกลับมาที่หน้าแอป (หรือภายใน 5 นาที)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary !py-2 !px-3"
                onClick={() => setDraft({ ...stored[role] })}
                disabled={!dirty || saving}
              >
                ยกเลิก
              </button>
              <button type="button" className="btn-primary !py-2 !px-3" onClick={save} disabled={!dirty || saving}>
                {saving ? <span className="spinner"/> : <Icon name="check" size={14}/>}
                บันทึกสิทธิ์
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
