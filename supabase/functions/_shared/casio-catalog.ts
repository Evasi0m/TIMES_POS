// CASIO model parser + filter classification (port of TIMES_SHOP src/lib/casio/*).

export const SERIES_RULES = [
  {
    id: 'gshock',
    label: 'G-SHOCK',
    test: (m: string) =>
      /^(G[A-Z]|GW|GM|GBD|GG|GST|GPR|GR|DW-[56789]|DW-H|GMA|MTG|MRG)/i.test(m),
  },
  {
    id: 'babyg',
    label: 'Baby-G',
    test: (m: string) => /^(B[A-Z]|BG[A-Z]|BGD|BGA|BGS|BA-|MSG|SHE)/i.test(m),
  },
  {
    id: 'edifice',
    label: 'Edifice',
    test: (m: string) => /^(EF|EQ[A-Z]|ECB|ERA|EFR|EFS|EFV)/i.test(m),
  },
  {
    id: 'protrek',
    label: 'PRO TREK',
    test: (m: string) => /^(PR[GWJST]|WSD)/i.test(m),
  },
  { id: 'standard', label: 'Casio ทั่วไป', test: () => true },
] as const;

export type WatchSeriesId = (typeof SERIES_RULES)[number]['id'];

export const SERIES_SUBS: Record<
  string,
  { id: string; label: string; prefixes: string[] }[]
> = {
  gshock: [
    { id: 'gs-anadigi', label: 'เข็ม+ดิจิทัล', prefixes: ['GA', 'GMA', 'GBA'] },
    { id: 'gs-digital', label: 'ดิจิทัล', prefixes: ['DW', 'GBD', 'GW', 'GWM'] },
    { id: 'gs-metal', label: 'สาย Metal / G-Steel', prefixes: ['GST', 'GM', 'GMS', 'GMW'] },
  ],
  standard: [
    {
      id: 'st-men',
      label: 'ผู้ชาย',
      prefixes: ['MTP', 'MTD', 'MTS', 'MDV', 'MW', 'AMW', 'MRW', 'MCW', 'HDA', 'HDC', 'AEQ'],
    },
    { id: 'st-lady', label: 'ผู้หญิง', prefixes: ['LTP', 'LTF', 'LRW', 'LWA'] },
    {
      id: 'st-digi',
      label: 'ดิจิทัล / Unisex',
      prefixes: ['A', 'F', 'MQ', 'W', 'B', 'AE', 'DB', 'LA', 'CA'],
    },
  ],
  edifice: [
    { id: 'ed-chrono', label: 'นาฬิกาจับเวลา', prefixes: ['EF', 'EFR', 'EFV', 'EFS', 'EFB'] },
    { id: 'ed-connect', label: 'Smart / Solar', prefixes: ['ECB', 'EQB', 'ERA'] },
  ],
  babyg: [
    { id: 'bg-anadigi', label: 'เข็ม+ดิจิทัล', prefixes: ['BGA', 'BA', 'MSG', 'SHE'] },
    { id: 'bg-digital', label: 'ดิจิทัล', prefixes: ['BGD', 'BGS'] },
  ],
};

export const MATERIAL_MAP: Record<string, string> = {
  R: 'เรซิน / ยาง',
  D: 'สแตนเลส',
  L: 'หนัง',
  G: 'สายบาน / ชุบทอง',
  SG: 'สองกษัตริย์',
  GL: 'ทอง + หนัง',
  T: 'ไทเทเนียม',
  C: 'คอมโพสิต',
};

export const COLOR_MAP: Record<string, { label: string; hex: string }> = {
  '1': { label: 'ดำ', hex: '#1d1d1f' },
  '2': { label: 'น้ำเงิน', hex: '#2563eb' },
  '3': { label: 'เขียว', hex: '#16a34a' },
  '4': { label: 'แดง', hex: '#dc2626' },
  '5': { label: 'น้ำตาล', hex: '#92400e' },
  '6': { label: 'ม่วง', hex: '#7c3aed' },
  '7': { label: 'ขาว/เงิน', hex: '#d1d5db' },
  '8': { label: 'เทา', hex: '#6b7280' },
  '9': { label: 'ทอง/เหลือง', hex: '#d97706' },
};

export const VALID_SERIES = new Set(SERIES_RULES.map((r) => r.id));
export const VALID_MATERIALS = new Set(Object.keys(MATERIAL_MAP));
export const VALID_COLORS = new Set(Object.keys(COLOR_MAP));

function normalizeModelCode(code: string): string {
  return String(code || '').trim().toUpperCase();
}

export function getCasioModelBase(code: string): string {
  const full = normalizeModelCode(code);
  if (!full) return '';
  const parts = full.split('-');
  if (parts.length < 2) return full;
  const last = parts[parts.length - 1];
  if (/^[1-9][A-Z0-9]*$/i.test(last)) {
    return parts.slice(0, -1).join('-');
  }
  return full;
}

export function getPrefix(code: string): string {
  const m = normalizeModelCode(code);
  const pm = m.match(/^([A-Z]+)/);
  return pm ? pm[1] : '';
}

export function parseCasioModel(code: string): { mat: string; color: string } {
  const m = normalizeModelCode(code);
  if (!m) return { mat: '', color: '' };
  const parts = m.split('-');
  if (parts.length < 2) return { mat: '', color: '' };

  let mat = '';
  const mid = parts[1];
  const matMatch = mid.match(/\d([A-Z]{1,2})$/);
  if (matMatch && VALID_MATERIALS.has(matMatch[1])) mat = matMatch[1];

  let color = '';
  const last = parts[parts.length - 1];
  const cm = last.match(/^([1-9])/);
  if (cm) color = cm[1];

  return { mat, color };
}

export function getSeries(modelCode: string): WatchSeriesId {
  const m = String(modelCode || '').trim();
  for (const r of SERIES_RULES) {
    if (r.id !== 'standard' && r.test(m)) return r.id;
  }
  return 'standard';
}

export function getSeriesLabel(seriesId: string): string {
  return SERIES_RULES.find((r) => r.id === seriesId)?.label || seriesId;
}

export function matchSubType(
  modelCode: string,
  sub: { prefixes: string[] },
): boolean {
  const prefix = getPrefix(modelCode);
  const m = normalizeModelCode(modelCode);
  return sub.prefixes.some((p) => prefix === p || m.indexOf(`${p}-`) === 0);
}

export function getSubTypeForModel(
  modelCode: string,
  seriesId: string,
): string | null {
  const subs = SERIES_SUBS[seriesId];
  if (!subs) return null;
  for (const sub of subs) {
    if (matchSubType(modelCode, sub)) return sub.id;
  }
  return null;
}

export function getSubTypeLabel(seriesId: string, subTypeId: string): string {
  const sub = SERIES_SUBS[seriesId]?.find((s) => s.id === subTypeId);
  return sub?.label || subTypeId;
}

export function getModelCodeFromRow(row: {
  sku_name?: string | null;
  seller_sku?: string | null;
}): string {
  return String(row.sku_name || row.seller_sku || '').trim();
}

export interface CasioEnriched {
  model_base: string;
  watch_series: WatchSeriesId;
  watch_sub_type: string | null;
  casio_prefix: string;
  strap_material: string;
  dial_color_code: string;
}

export function enrichCasioFromModelCode(code: string): CasioEnriched {
  const model = normalizeModelCode(code);
  if (!model) {
    return {
      model_base: '',
      watch_series: 'standard',
      watch_sub_type: null,
      casio_prefix: '',
      strap_material: 'R',
      dial_color_code: '',
    };
  }

  const parsed = parseCasioModel(model);
  const watch_series = getSeries(model);
  const watch_sub_type = getSubTypeForModel(model, watch_series);

  return {
    model_base: getCasioModelBase(model),
    watch_series,
    watch_sub_type,
    casio_prefix: getPrefix(model),
    strap_material: parsed.mat || 'R',
    dial_color_code: parsed.color || '',
  };
}
