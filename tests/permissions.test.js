import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_PERMISSIONS,
  DEFAULT_ROLE_PERMISSIONS,
  EDITABLE_ROLES,
  PERMISSION_GROUPS,
  can,
  effectivePermissions,
  groupsMissingView,
  normalizePermissions,
} from '../src/lib/permissions.js';
import { NAV, canNavigate, landingView, navForRole } from '../src/lib/nav-config.js';
import { TIKTOK_SECTIONS, tiktokSectionsFor } from '../src/lib/ecommerce-nav.js';

const MIGRATION = readFileSync(
  new URL('../supabase-migrations/086_role_permissions.sql', import.meta.url),
  'utf8',
);

/** The jsonb literal seeded for one role in migration 086. */
function seededPerms(role) {
  const m = MIGRATION.match(new RegExp(`\\('${role}', '(\\{[\\s\\S]*?\\})'::jsonb\\)`));
  if (!m) throw new Error(`no seed for ${role}`);
  return JSON.parse(m[1]);
}

/** Split 'a.b|c.d' and keep only key-shaped tokens (doc examples like 'a|b' are skipped). */
const keysOf = (str) => str.split('|').filter(k => k.includes('.'));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('permission catalog', () => {
  it('has unique keys the DB accepts (set_role_permissions keeps ^[a-z_]+\\.[a-z_]+$)', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const k of ALL_PERMISSIONS) expect(k).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('points every group viewKey at a real view permission', () => {
    for (const g of PERMISSION_GROUPS) {
      if (g.viewKey) expect(ALL_PERMISSIONS).toContain(g.viewKey);
    }
  });
});

describe('defaults match migration 086 seed', () => {
  it.each(EDITABLE_ROLES)('%s', (role) => {
    const seeded = normalizePermissions(seededPerms(role));
    expect(seeded).toEqual(DEFAULT_ROLE_PERMISSIONS[role]);
  });

  it('seeds only known keys', () => {
    for (const role of EDITABLE_ROLES) {
      for (const k of Object.keys(seededPerms(role))) expect(ALL_PERMISSIONS).toContain(k);
    }
  });
});

describe('every key the DB or the app checks exists in the catalog', () => {
  it('DB: RPC guards, RLS policies (has_perm / perm column)', () => {
    const keys = new Set();
    for (const m of MIGRATION.matchAll(/has_perm\('([^']+)'\)/g)) keysOf(m[1]).forEach(k => keys.add(k));
    for (const m of MIGRATION.matchAll(/\('[a-z_]+',\s+'([a-z_.|]+)',\s+(?:NULL|'p_kind')/g)) {
      keysOf(m[1]).forEach(k => keys.add(k));
    }
    for (const m of MIGRATION.matchAll(/'([a-z_]+\.[a-z_]+(?:\|[a-z_]+\.[a-z_]+)+)'::text/g)) {
      keysOf(m[1]).forEach(k => keys.add(k));
    }
    for (const m of MIGRATION.matchAll(/"(?:receive|claim|return)": "([a-z_.]+)"/g)) keys.add(m[1]);
    expect(keys.size).toBeGreaterThan(20);
    for (const k of keys) expect(ALL_PERMISSIONS, `unknown key in migration: ${k}`).toContain(k);
  });

  it('edge functions (has_perm / callerHasPerm)', () => {
    const dir = new URL('../supabase/functions', import.meta.url).pathname;
    const keys = new Set();
    for (const f of walk(dir).filter(p => p.endsWith('.ts'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/p_perm: '([^']+)'/g)) keysOf(m[1]).forEach(k => keys.add(k));
      for (const m of src.matchAll(/callerHasPerm\(\s*req,\s*'([^']+)'/g)) keysOf(m[1]).forEach(k => keys.add(k));
      for (const m of src.matchAll(/\? '([a-z_]+\.[a-z_]+)'\s*\n?\s*: '([a-z_]+\.[a-z_]+)'/g)) { keys.add(m[1]); keys.add(m[2]); }
    }
    expect(keys.size).toBeGreaterThan(5);
    for (const k of keys) expect(ALL_PERMISSIONS, `unknown key in edge fn: ${k}`).toContain(k);
  });

  it('app: can(...) / useCan(...) literals', () => {
    const dir = new URL('../src', import.meta.url).pathname;
    const keys = new Set();
    for (const f of walk(dir).filter(p => /\.(jsx?|js)$/.test(p))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/\b(?:can|useCan|canPerm\(perms,)\s*\(?\s*'([a-z_.|]+)'/g)) {
        keysOf(m[1]).forEach(k => keys.add(k));
      }
      for (const m of src.matchAll(/perm: '([a-z_.|]+)'/g)) keysOf(m[1]).forEach(k => keys.add(k));
    }
    expect(keys.size).toBeGreaterThan(30);
    for (const k of keys) expect(ALL_PERMISSIONS, `unknown key in app: ${k}`).toContain(k);
  });
});

describe('effectivePermissions / can', () => {
  it('gives super_admin everything regardless of stored data', () => {
    const p = effectivePermissions('super_admin', { 'pos.sell': false });
    expect(ALL_PERMISSIONS.every(k => p[k])).toBe(true);
  });

  it('falls back to role defaults when nothing is loaded', () => {
    expect(effectivePermissions('staff', null)).toEqual(DEFAULT_ROLE_PERMISSIONS.staff);
  });

  it('uses the stored map when present, unknown roles get nothing', () => {
    expect(effectivePermissions('staff', { 'pos.sell': true })['pos.sell']).toBe(true);
    expect(effectivePermissions('staff', { 'pos.sell': true })['view.sales']).toBe(false);
    expect(Object.values(effectivePermissions('hacker', null)).some(Boolean)).toBe(false);
  });

  it('can() supports any-of and fails closed on typos', () => {
    const p = normalizePermissions({ 'view.sales': true });
    expect(can(p, 'view.sales')).toBe(true);
    expect(can(p, 'pos.sell|view.sales')).toBe(true);
    expect(can(p, 'pos.sell')).toBe(false);
    expect(can(p, 'view.sale')).toBe(false);
    expect(can(null, 'view.sales')).toBe(false);
  });

  it('staff default is view-only: no action keys', () => {
    const staff = DEFAULT_ROLE_PERMISSIONS.staff;
    const actions = ALL_PERMISSIONS.filter(k => !k.startsWith('view.') && staff[k]);
    expect(actions).toEqual([]);
    expect(staff['view.sales'] && staff['view.ecommerce'] && staff['view.pos']).toBe(true);
  });
});

describe('navigation follows permissions', () => {
  it('lands on the first page the user may open', () => {
    expect(landingView(DEFAULT_ROLE_PERMISSIONS.visitor)).toBe('products');
    expect(landingView(DEFAULT_ROLE_PERMISSIONS.staff)).toBe('pos');
    expect(landingView(normalizePermissions({}))).toBe('products');
  });

  it('hides E-Commerce without its permission, locks the rest', () => {
    const visitor = DEFAULT_ROLE_PERMISSIONS.visitor;
    const keys = navForRole(visitor).map(it => it.k);
    expect(keys).not.toContain('ecommerce');
    expect(keys).toContain('dashboard');
    expect(canNavigate(visitor, NAV.find(it => it.k === 'dashboard'))).toBe(false);
    expect(navForRole(DEFAULT_ROLE_PERMISSIONS.staff).map(it => it.k)).toContain('ecommerce');
  });

  it('TikTok sub-tabs follow their keys', () => {
    const staffCan = (k) => can(DEFAULT_ROLE_PERMISSIONS.staff, k);
    expect(tiktokSectionsFor(staffCan).map(s => s.k)).toEqual(['orders']);
    const all = () => true;
    expect(tiktokSectionsFor(all)).toHaveLength(TIKTOK_SECTIONS.length);
  });
});

describe('groupsMissingView', () => {
  it('flags actions on a page that is switched off', () => {
    const p = normalizePermissions({ 'pos.sell': true, 'view.sales': true, 'sales.void': true });
    expect(groupsMissingView(p)).toEqual(['pos']);
  });
});
