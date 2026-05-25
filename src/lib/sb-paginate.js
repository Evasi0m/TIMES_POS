// Chunked pagination helper for Supabase / PostgREST list queries.
//
// Why this exists:
//   PostgREST enforces a server-side `max-rows` cap (1000 in Supabase by
//   default). Calling `.range(0, 19999)` does NOT bypass it — the server
//   silently truncates to 1000 rows, which is how we ended up shipping a
//   ProductsView that only saw the most recent 1000 SKUs of a 6,000-row
//   catalog. The bug had no error message; lists were just incomplete.
//
// Usage:
//   import { fetchAll } from '@/lib/sb-paginate';
//   const { data, error } = await fetchAll(
//     () => sb.from('products').select('*').order('id', { ascending: false })
//   );
//
//   // With a query builder you mutate per page:
//   const { data, error } = await fetchAll((from, to) =>
//     sb.from('orders')
//       .select('*, items:order_items(*)')
//       .gte('created_at', start)
//       .order('id', { ascending: false })
//       .range(from, to)
//   );
//
// The callback receives (from, to) so the caller controls the column +
// filters; we just wrap the loop. If the callback ignores those args and
// returns the same query each time, you'll fetch the same page in a loop —
// so always thread them through to .range().

const DEFAULTS = {
  pageSize: 1000,
  hardCap: 50000, // safety: alarm if a catalog ever explodes past this
};

/**
 * Run a Supabase select query in chunks until we get a short page back.
 *
 * @param {(from:number, to:number) => PromiseLike<{data:any[]|null, error:any}>} buildQuery
 *   Function that returns a Supabase query promise for the given row range.
 * @param {{ pageSize?: number, hardCap?: number }} [opts]
 * @returns {Promise<{ data: any[], error: any|null }>}
 */
export async function fetchAll(buildQuery, opts = {}) {
  // Default-destructure (NOT spread) so explicit `undefined` from a caller
  // — e.g. fetchAllFromTable forwarding optional opts — still falls through
  // to the default. A naive `{ ...DEFAULTS, ...opts }` would let undefined
  // overwrite the default, producing pageSize=undefined and an infinite
  // loop where every `data.length < undefined` comparison stays false.
  const { pageSize = DEFAULTS.pageSize, hardCap = DEFAULTS.hardCap } = opts;
  const all = [];
  let from = 0;

  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) return { data: all, error };
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
    if (from > hardCap) {
      // Don't crash — return what we have, surface a synthetic error so the
      // caller can warn the user that the catalog grew unexpectedly.
      return {
        data: all,
        error: new Error(
          `fetchAll: hardCap (${hardCap}) reached — refusing to load more rows. ` +
            `Adjust hardCap if this is legitimate.`
        ),
      };
    }
  }

  return { data: all, error: null };
}

/**
 * Convenience wrapper for the common case: select a single table with
 * an order column, no joins, no extra filters.
 *
 * @param {object} sb       Supabase client
 * @param {string} table
 * @param {{ select?: string, orderColumn?: string, ascending?: boolean,
 *           pageSize?: number, hardCap?: number }} [opts]
 */
export async function fetchAllFromTable(sb, table, opts = {}) {
  const {
    select = '*',
    orderColumn = 'id',
    ascending = false,
    pageSize,
    hardCap,
  } = opts;
  return fetchAll(
    (from, to) =>
      sb.from(table).select(select).order(orderColumn, { ascending }).range(from, to),
    { pageSize, hardCap }
  );
}
