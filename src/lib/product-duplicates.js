// Find POS products that are probably the same watch keyed twice
// (e.g. "AQ-240E-7A2" and "AQ-240B-7A2DF"). Pure logic — no Supabase.
//
// Casio colour variants legitimately differ by one character
// (AQ-240E-2A vs AQ-240E-3A), so a small edit distance alone is only a hint.
// Strong signals: same model after dropping the distributor tail, a TikTok
// seller SKU that names the other product, or the same barcode.

/** Distributor / packaging tails appended to the model code. */
const TAIL_RE = /(?:[VUMJPY])?(?:DF|DR|JF|JR|PF|EF)$/;

export function isRetiredName(name) {
  return /ผิด|ไม่ใช้/.test(String(name || ''));
}

/** "AQ-240B-7A2DF" → "AQ-240B-7A2"; spaces, brackets and case ignored. */
export function normalizeModel(name) {
  let s = String(name || '').toUpperCase().replace(/\(.*?\)/g, '').replace(/\s+/g, '');
  s = s.replace(TAIL_RE, '');
  return s;
}

/** Levenshtein distance, capped (returns cap+1 when above). */
export function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Characters where two equal-length strings differ (or null when lengths differ). */
function diffPositions(a, b) {
  if (a.length !== b.length) return null;
  const out = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

/**
 * Candidate duplicate pairs.
 * @param {Array<{id, name, barcode?, tiktokSkus?: string[]}>} products
 * @returns {Array<{a, b, level: 'high'|'medium', reasons: string[]}>}
 *   a/b are the product objects; level 'high' = very likely the same watch.
 */
export function findDuplicateCandidates(products, { maxDistance = 2 } = {}) {
  const live = (products || []).filter(p => p?.name && !isRetiredName(p.name));
  const norm = new Map(live.map(p => [p.id, normalizeModel(p.name)]));
  const pairs = new Map();
  const add = (a, b, level, reason) => {
    if (a.id === b.id) return;
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    const key = `${x.id}:${y.id}`;
    const cur = pairs.get(key) || { a: x, b: y, level: 'medium', reasons: [] };
    if (level === 'high') cur.level = 'high';
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    pairs.set(key, cur);
  };

  // 1. same normalized model
  const byNorm = new Map();
  for (const p of live) {
    const k = norm.get(p.id);
    if (k.length < 4) continue;
    byNorm.set(k, [...(byNorm.get(k) || []), p]);
  }
  for (const group of byNorm.values()) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) add(group[i], group[j], 'high', 'ชื่อรุ่นเดียวกัน (ต่างแค่ท้าย DF/VDF หรือช่องว่าง)');
  }

  // 2. a TikTok seller SKU on one product names another product
  for (const p of live) {
    for (const sku of p.tiktokSkus || []) {
      const k = normalizeModel(sku);
      if (k === norm.get(p.id)) continue;
      for (const q of byNorm.get(k) || []) add(p, q, 'high', `TikTok SKU ${sku} ผูกกับ ${p.name}`);
    }
  }

  // 3. same barcode
  const byBarcode = new Map();
  for (const p of live) {
    const bc = String(p.barcode || '').trim();
    if (bc.length < 6) continue;
    byBarcode.set(bc, [...(byBarcode.get(bc) || []), p]);
  }
  for (const [bc, group] of byBarcode) {
    for (let i = 0; i < group.length; i++)
      for (let j = i + 1; j < group.length; j++) add(group[i], group[j], 'high', `บาร์โค้ดเดียวกัน ${bc}`);
  }

  // 4. near-identical model codes (hint only: could be a colour variant)
  const byPrefix = new Map();
  for (const p of live) {
    const k = norm.get(p.id);
    if (k.length < 6) continue;
    const pre = k.slice(0, 4);
    byPrefix.set(pre, [...(byPrefix.get(pre) || []), p]);
  }
  for (const group of byPrefix.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const x = norm.get(group[i].id);
        const y = norm.get(group[j].id);
        if (x === y) continue;
        const d = editDistance(x, y, maxDistance);
        if (d > maxDistance) continue;
        const pos = diffPositions(x, y);
        const where = pos && pos.length ? `ต่างที่ตัวที่ ${pos.map(n => n + 1).join(', ')}` : `ต่าง ${d} ตัวอักษร`;
        add(group[i], group[j], 'medium', `ชื่อคล้ายกัน (${where}) — อาจเป็นคนละสี`);
      }
    }
  }

  const rank = { high: 0, medium: 1 };
  return [...pairs.values()].sort((p, q) => rank[p.level] - rank[q.level] || p.a.name.localeCompare(q.a.name));
}

/** Existing products that look like `name` — for the add-product warning. */
export function findSimilarToName(name, products, { maxDistance = 2 } = {}) {
  const k = normalizeModel(name);
  if (k.length < 4) return [];
  const out = [];
  for (const p of products || []) {
    if (!p?.name || isRetiredName(p.name)) continue;
    const pk = normalizeModel(p.name);
    if (pk === k) { out.push({ product: p, level: 'high' }); continue; }
    if (pk.slice(0, 4) !== k.slice(0, 4)) continue;
    if (editDistance(pk, k, maxDistance) <= maxDistance) out.push({ product: p, level: 'medium' });
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'high' ? -1 : 1));
}
