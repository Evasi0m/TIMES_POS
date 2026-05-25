// Shop-level operating expenses (electricity, rent, staff salary +
// commission, packaging, plus user-defined "อื่นๆ"). Stored separately
// from product cost so the P&L view can split them clearly.
//
// Pure module: no React, no Supabase. The fixed categories live here so
// formula tests can run against the same data the modal renders.

export const EXPENSE_CATEGORIES = [
  { key: 'electricity',  label: 'ค่าไฟ',                  icon: 'zap'         },
  { key: 'rent',         label: 'ค่าเช่าร้าน',             icon: 'store'       },
  { key: 'staff_1',      label: 'ค่าพนักงาน คนที่ 1',     icon: 'user', staff: true },
  { key: 'staff_2',      label: 'ค่าพนักงาน คนที่ 2',     icon: 'user', staff: true },
  { key: 'shipping_box', label: 'ค่ากล่องพัสดุ',          icon: 'box'         },
  { key: 'tape',         label: 'ค่าเทป',                 icon: 'tag'         },
];

export const EXPENSE_CAT_MAP = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.key, c])
);

/**
 * Compute the final amount for a staff category given:
 *   - d.base_salary    fixed monthly base
 *   - d.commission_pct percent of monthly shop sales (0–100)
 *   - monthSales       total shop revenue for the month
 *
 * Returns base + (pct/100) × monthSales. Defensive against missing/NaN
 * inputs (returns 0 components in that case).
 */
export function staffComputed(d, monthSales) {
  const base = Number(d?.base_salary) || 0;
  const pct = Number(d?.commission_pct) || 0;
  return base + (pct / 100) * (Number(monthSales) || 0);
}

/**
 * Sum every category in a month draft into a single total. Staff rows are
 * computed via `staffComputed`; everything else uses `d.amount`.
 *
 * @param {Record<string, any>} draft   keyed by category.key (or 'other:<label>')
 * @param {number} monthSales            shop revenue for that month
 * @param {Array<{key:string, staff?:boolean}>} categories  default = EXPENSE_CATEGORIES
 */
export function monthExpenseTotal(draft, monthSales, categories = EXPENSE_CATEGORIES) {
  let total = 0;
  for (const c of categories) {
    const d = draft?.[c.key];
    if (!d) continue;
    if (c.staff) total += staffComputed(d, monthSales);
    else total += Number(d.amount) || 0;
  }
  // Free-form "other" rows live under keys prefixed with 'other:'
  for (const k of Object.keys(draft || {})) {
    if (!k.startsWith('other:')) continue;
    const d = draft[k];
    total += Number(d?.amount) || 0;
  }
  return total;
}

/**
 * Compute "real net profit" given gross profit and total shop expenses.
 * Wrapper kept here so the formula has a single canonical home.
 */
export function realNetProfit(grossProfit, shopExpenseTotal) {
  return (Number(grossProfit) || 0) - (Number(shopExpenseTotal) || 0);
}
