# Supabase Migrations

SQL migrations for the TIMES POS Supabase project. Each file is idempotent (safe to re-run) and self-contained.

## How to apply

The repo does not use the Supabase CLI (yet). Apply each file by copy-pasting into the SQL editor in the Supabase dashboard, in numbered order:

1. Open **Supabase Dashboard → SQL Editor → New query**
2. Paste the file contents
3. Run

Recommended order: lowest number first.

## Files

| File | Purpose | Required? |
|---|---|---|
| `001_create_sale_order_with_items.sql` | Atomic POS sale: insert `sale_orders` + `sale_order_items` + decrement stock in one transaction. Replaces 3 separate client calls. | **Yes** — fixes data-integrity bug if a step fails mid-flow |
| `002_create_stock_movement_with_items.sql` | Atomic receive / supplier-claim / customer-return: insert header + items + adjust stock in one transaction. | **Yes** — same correctness reason as 001 |
| `003_rls_audit.sql` | Read-only diagnostic. Lists every public-schema table, whether RLS is enabled, and how many policies exist. Use this to find unprotected tables before applying policies. | **Yes** — informational, run before 004 |
| `004_rls_policies.sql` | Enables RLS and applies "authenticated users only" policies on every table the app reads/writes. Tighten further per your role model. | **Yes** — without this, the anon JWT in `index.html` can read/write everything |
| `005_user_roles.sql` | Adds `app_role` (admin / cashier) to `auth.users` raw_app_meta_data + helper `auth_role()` function. Required for Phase 1.4. | Required for Phase 1.4 |

## After applying

- Test the POS flow end-to-end (sell → receipt → void). The client now calls `create_sale_order_with_items` instead of three separate inserts.
- Test stock-in / claim / return flow.
- Re-run `003_rls_audit.sql` and confirm every public table has `rowsecurity = true` and at least one policy.

## Permissions (086+) — read before writing a migration

Since `086_role_permissions.sql`, what a user may do comes from
`public.role_permissions` (edited in the app: การตั้งค่า user → สิทธิ์ตามบทบาท)
and is checked by `public.has_perm('key')`. Keys mirror `src/lib/permissions.js`.

- **Every RPC the app calls is guarded by a wrapper.** The real body lives in
  `<name>__impl`; `<name>` checks the permission listed in
  `public.rpc_perm_guards` and then calls it.
- **If your migration does `CREATE OR REPLACE` on one of those functions, it
  replaces the wrapper and the guard is gone.** End the migration with
  `SELECT public.apply_perm_guards();` — it wraps your new body again.
- **A new RPC the app calls** needs a row in `public.rpc_perm_guards`
  (`fn_name`, `perm`) plus `SELECT public.apply_perm_guard('<name>');`.
- **New table the app writes directly** needs RLS using
  `(SELECT public.has_perm('…'))`, not `is_admin()`.
- Check: `SELECT * FROM public.perm_guard_status WHERE NOT guarded OR unguarded_body;`
  should return no rows.

## Naming conventions

- All RPC functions are `SECURITY DEFINER` so they run with the function-owner's permissions, but they explicitly check `auth.uid() IS NOT NULL` before doing any work — anonymous calls fail.
- All functions return JSON (the inserted header row) so the client can read the new `id` without an extra round-trip.
- Migration files never `DROP` data — only `CREATE OR REPLACE` and `ALTER ... ENABLE`.
