// Pure product classification + filtering utilities.
//
// Why client-side:
//   The shop's CSV import overwrites the products table by barcode. Storing
//   derived attributes (brand, series, material, color) as DB columns would
//   require backfill after every import AND a Postgres function to keep them
//   in sync. Doing it in JS at load time means a fresh import "just works"
//   for the filter UI without touching the schema.
//
// What's here (all pure, no React, no Supabase):
//   - BRAND_RULES / SERIES_RULES / SERIES_SUBS / MATERIAL_MAP / COLOR_MAP
//   - classifyBrand(name)         → 'seiko' | 'alba' | 'citizen' | 'casio' | 'other'
//   - classifySeries(name)        → CASIO sub-brand id (only relevant when brand='casio')
//   - parseCasioModel(name)       → { mat, color } from "MTP-1302D-7A2"
//   - enrichProduct(p)            → adds _brand/_series/_material/_color/_prefix/_searchText
//   - matchSubType(p, sub)        → boolean (does product belong to a CASIO sub-type?)
//   - filterProducts(list, state) → applies all filter dimensions
//   - sortProducts(list, mode)    → returns sorted copy
//
// Doc reference: /Users/j3da1/.windsurf/plans/product-filter-readiness-82477b.md

// ────────────────────────────────────────────────────────────────────────
// Brand rules — first-match wins. Order matters: more-specific patterns go
// before broad ones. CASIO ALWAYS comes last among the named brands because
// its prefixes overlap with other brands' single-letter prefixes.
// ────────────────────────────────────────────────────────────────────────
export const BRAND_RULES = [
  // Seiko: starts with S + one of N/R/K/S/U/X/Y/W/E/D/P + letter|digit. Excludes "SHE" (Casio Sheen).
  { id: 'seiko',   label: 'Seiko',   test: m => /^S[NRKSUXYWEDP][A-Z0-9]/i.test(m) && !/^SHE/i.test(m) },
  // Alba: AH/AS/AT followed by 6+ alphanumerics with no dash (compact format like AH7Q24X1)
  { id: 'alba',    label: 'Alba',    test: m => /^A[HST][0-9A-Z]{6,}$/i.test(m.replace(/-.*$/, '')) || /^A[HST][0-9][A-Z][0-9]/i.test(m) },
  // Citizen: EW/EU/EM/BI/BJ/BM/BU/JY/NH/NJ/NP/EP followed by digit (compact, no dash)
  { id: 'citizen', label: 'Citizen', test: m => /^(EW|EU|EM|BI|BJ|BM|BU|JY|NH|NJ|NP|EP)\d/i.test(m) },
  // CASIO: catches all known CASIO product-family prefixes seen in the data.
  // Includes G-SHOCK (GA/GW/GM/GST/...), Baby-G (BGA/BGD/BA/MSG/SHE), Edifice
  // (EFR/EFV/EQS/ECB), PRO TREK (PRG/PRW/WSD), and standard (MTP/LTP/MQ/AE/...)
  { id: 'casio',   label: 'Casio',   test: m => /^(MTP|LTP|GA|BGA|DW|BA|GMA|EFR|GM|EFV|BGD|SHE|GST|MRW|MQ|AE|MTD|GBA|LQ|MSG|MDV|MW|LRW|AMW|BEM|GMD|GW|GBD|GD|ECB|EQS|EQB|EFB|MTG|MRG|GWM|PRG|PRW|PRS|PRT|PRJ|WSD|MTL|MTW|HDA|HDC|AEQ|LTF|LWA|MCW|F-?\d|W-?\d|A-?\d|AW-?\d|LA-?\d|CA-?\d|DB-?\d|AQ-?\d)/i.test(m) },
  // Anything else (3PP, products with non-letter starts, etc.)
  { id: 'other',   label: 'อื่น ๆ', test: () => true },
];

// CASIO sub-brand series. Only consulted when _brand === 'casio'.
export const SERIES_RULES = [
  { id: 'gshock',   label: 'G-SHOCK',         test: m => /^(G[A-Z]|GW|GM|GBD|GG|GST|GPR|GR|DW-[56789]|DW-H|GMA|MTG|MRG)/i.test(m) },
  { id: 'babyg',    label: 'Baby-G / Sheen',  test: m => /^(BG[A-Z]|BGD|BGA|BGS|BA-|MSG|SHE)/i.test(m) },
  { id: 'edifice',  label: 'Edifice',         test: m => /^(EF|EQ[A-Z]|ECB|ERA|EFR|EFS|EFV|EFB)/i.test(m) },
  { id: 'protrek',  label: 'PRO TREK',        test: m => /^(PR[GWJST]|WSD)/i.test(m) },
  { id: 'standard', label: 'CASIO มาตรฐาน',   test: () => true }, // fallback
];

// Sub-types within each CASIO series, identified by model prefix.
export const SERIES_SUBS = {
  gshock: [
    { id: 'gs-anadigi', label: 'เข็ม+ดิจิทัล',      prefixes: ['GA', 'GMA', 'GBA'] },
    { id: 'gs-digital', label: 'ดิจิทัล',            prefixes: ['DW', 'GBD', 'GW', 'GWM', 'GD', 'GMD'] },
    { id: 'gs-metal',   label: 'Metal / G-Steel',    prefixes: ['GST', 'GM', 'GMS', 'GMW', 'MTG', 'MRG'] },
  ],
  babyg: [
    { id: 'bg-anadigi', label: 'เข็ม+ดิจิทัล',      prefixes: ['BGA', 'BA', 'MSG', 'SHE'] },
    { id: 'bg-digital', label: 'ดิจิทัล',            prefixes: ['BGD', 'BGS'] },
  ],
  edifice: [
    { id: 'ed-chrono',  label: 'Chronograph',        prefixes: ['EF', 'EFR', 'EFV', 'EFS', 'EFB'] },
    { id: 'ed-connect', label: 'Connected / Solar',  prefixes: ['ECB', 'EQB', 'EQS', 'ERA'] },
  ],
  standard: [
    { id: 'st-men',     label: 'ผู้ชาย',             prefixes: ['MTP', 'MTD', 'MTS', 'MDV', 'MW', 'AMW', 'MRW', 'MCW', 'HDA', 'HDC', 'AEQ', 'MTL', 'MTW'] },
    { id: 'st-lady',    label: 'ผู้หญิง',            prefixes: ['LTP', 'LTF', 'LRW', 'LWA', 'LQ'] },
    { id: 'st-digi',    label: 'ดิจิทัล / Unisex',  prefixes: ['A', 'F', 'MQ', 'W', 'AE', 'DB', 'LA', 'CA', 'AQ', 'AW', 'BEM'] },
  ],
  // protrek deliberately has no sub-types (matches TIMES_Catalog behavior)
};

// Material codes parsed from the middle segment of a CASIO model code.
// Codes that are not in this map will be omitted from the material filter UI
// (the product itself still appears in normal search results).
export const MATERIAL_MAP = {
  R:  { label: 'เรซิน/ยาง',     swatch: '#222' },
  D:  { label: 'สแตนเลส',        swatch: '#cbd5e1' },
  L:  { label: 'หนัง',           swatch: '#92400e' },
  G:  { label: 'ชุบทอง',         swatch: '#d97706' },
  SG: { label: 'สองกษัตริย์',    swatch: 'linear-gradient(135deg,#cbd5e1 50%,#d97706 50%)' },
  GL: { label: 'ทอง+หนัง',       swatch: 'linear-gradient(135deg,#d97706 50%,#92400e 50%)' },
  T:  { label: 'ไทเทเนียม',      swatch: '#9ca3af' },
  C:  { label: 'คอมโพสิต',        swatch: '#374151' },
};

// Color codes (last segment of CASIO model). 1-9 only.
export const COLOR_MAP = {
  '1': { label: 'ดำ',         hex: '#1d1d1f' },
  '2': { label: 'น้ำเงิน',     hex: '#2563eb' },
  '3': { label: 'เขียว',       hex: '#16a34a' },
  '4': { label: 'แดง',        hex: '#dc2626' },
  '5': { label: 'น้ำตาล',      hex: '#92400e' },
  '6': { label: 'ม่วง',         hex: '#7c3aed' },
  '7': { label: 'ขาว/เงิน',    hex: '#d1d5db' },
  '8': { label: 'เทา',         hex: '#6b7280' },
  '9': { label: 'ทอง/เหลือง',  hex: '#d97706' },
};

// Price presets (inclusive ranges; max=0 = no upper bound)
export const PRICE_PRESETS = [
  { id: 'lt1k',   label: '< ฿1,000',       min: 0,     max: 999   },
  { id: '1-5k',   label: '฿1,000–5,000',   min: 1000,  max: 5000  },
  { id: '5-10k',  label: '฿5,000–10,000',  min: 5000,  max: 10000 },
  { id: 'gt10k',  label: '฿10,000+',       min: 10000, max: 0     },
];

// ────────────────────────────────────────────────────────────────────────
// Classifiers
// ────────────────────────────────────────────────────────────────────────

/** Returns the brand id for a product name, or 'other' if no rule matched. */
export function classifyBrand(name) {
  for (const r of BRAND_RULES) if (r.test(name || '')) return r.id;
  return 'other';
}

/** Returns the CASIO series id (only meaningful when brand === 'casio'). */
export function classifySeries(name) {
  for (const r of SERIES_RULES) if (r.test(name || '')) return r.id;
  return 'standard';
}

/**
 * Parse CASIO model code:  MTP-1302D-7A2  →  { mat:'D', color:'7' }
 * Doc reference: §7-8 of Product_filter.md
 */
export function parseCasioModel(m) {
  if (!m) return { mat: '', color: '' };
  const parts = m.split('-');
  if (parts.length < 2) return { mat: '', color: '' };
  let mat = '';
  const mid = parts[1];
  const matMatch = mid.match(/\d([A-Z]{1,2})$/);
  if (matMatch) mat = matMatch[1];
  let color = '';
  const last = parts[parts.length - 1];
  const cm = last.match(/^([1-9])/);
  if (cm) color = cm[1];
  return { mat, color };
}

/**
 * Add derived fields needed by filter / search. Pure: never mutates the
 * input. Returns a new object spreading `p` plus _brand/_series/_material/
 * _color/_prefix/_searchText.
 */
export function enrichProduct(p) {
  const m = (p.name || '').trim();
  const _brand  = classifyBrand(m);
  const _series = _brand === 'casio' ? classifySeries(m) : '';
  const parsed  = parseCasioModel(m);
  const _material = _brand === 'casio' ? (parsed.mat || 'R') : '';
  const _color    = _brand === 'casio' ? parsed.color : '';
  const _prefix   = (m.match(/^([A-Z]+)/i)?.[1] || '').toUpperCase();
  const _searchText = m.toLowerCase().replace(/[\s\-_.]/g, '');
  return { ...p, _brand, _series, _material, _color, _prefix, _searchText };
}

/** Sub-type matcher — uses prefix list with a `prefix-` fallback (e.g. "BA-110"). */
export function matchSubType(p, sub) {
  if (!sub) return true;
  return sub.prefixes.some(
    pf =>
      p._prefix === pf.toUpperCase() ||
      (p.name || '').toUpperCase().indexOf(pf.toUpperCase() + '-') === 0
  );
}

/** Effective price for filtering / sorting. Returns null if no usable price. */
export function getEffectivePrice(p) {
  const v = Number(p.retail_price);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Apply all filter dimensions. Caller is responsible for sorting afterwards.
 * `state` shape:
 *   { brand, series, subType, material, color, minPrice, maxPrice,
 *     inStockOnly, query }
 */
export function filterProducts(list, state) {
  let d = list;
  if (state.brand && state.brand !== 'all') d = d.filter(p => p._brand === state.brand);
  if (state.series) d = d.filter(p => p._series === state.series);
  if (state.subType) {
    const subs = SERIES_SUBS[state.series] || [];
    const sub = subs.find(s => s.id === state.subType);
    if (sub) d = d.filter(p => matchSubType(p, sub));
  }
  if (state.material) d = d.filter(p => p._material === state.material);
  if (state.color)    d = d.filter(p => p._color === state.color);
  if (state.minPrice > 0) d = d.filter(p => { const v = getEffectivePrice(p); return v != null && v >= state.minPrice; });
  if (state.maxPrice > 0) d = d.filter(p => { const v = getEffectivePrice(p); return v != null && v <= state.maxPrice; });
  if (state.inStockOnly) d = d.filter(p => Number(p.current_stock) > 0);
  if (state.query && state.query.trim()) {
    const raw = state.query.trim();
    const q = raw.toLowerCase().replace(/[\s\-_.]/g, '');
    if (q) d = d.filter(p => p._searchText.includes(q) || (p.barcode || '') === raw);
  }
  return d;
}

/** Returns a sorted copy of `list`. Modes: newest|oldest|price-asc|price-desc|name. */
export function sortProducts(list, mode) {
  const arr = [...list];
  switch (mode) {
    case 'oldest':     arr.sort((a, b) => (a.id || 0) - (b.id || 0)); break;
    case 'price-asc':  arr.sort((a, b) => (Number(a.retail_price) || 0) - (Number(b.retail_price) || 0)); break;
    case 'price-desc': arr.sort((a, b) => (Number(b.retail_price) || 0) - (Number(a.retail_price) || 0)); break;
    case 'name':       arr.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'th')); break;
    case 'newest':
    default:           arr.sort((a, b) => (b.id || 0) - (a.id || 0));
  }
  return arr;
}
