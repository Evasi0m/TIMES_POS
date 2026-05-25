-- Migration 011: per-shop overrides for the paylater/COD net-received estimator.
--
-- The "คำนวณอัตโนมัติ" button on the POS view runs a multi-step formula
-- (price-bracket markdown → markups → bracket markdown by C → flat fee)
-- to estimate how much money the shop actually receives after platform
-- + paylater provider fees. The constants in that formula are shop-
-- specific (each platform/provider has its own fee schedule and the
-- shopkeeper renegotiates them periodically), so we expose them as
-- editable settings instead of hard-coding.
--
-- Stored as a single JSONB column rather than ~12 numeric columns so:
--   • new fields can be added without DDL migrations,
--   • the whole config is updated atomically,
--   • the source of truth for defaults stays in code (DEFAULT_PAYLATER_CONFIG
--     in src/lib/money.js) — NULL here means "use code defaults".
--
-- See plan: paylater-formula-settings-a236c5.

ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS paylater_config JSONB DEFAULT NULL;

COMMENT ON COLUMN shop_settings.paylater_config IS
'Per-shop overrides for the paylater/COD net-received estimator.
Schema:
  {
    "tier1":  { "high_threshold": 8000, "mid_threshold": 3500,
                "high_pct": 55, "mid_pct": 58, "low_pct": 55 },
    "markup": { "pct1": 37, "pct2": 11 },
    "tier2":  { "high_threshold": 6000, "mid_threshold": 2500,
                "high_pct": 10, "mid_pct": 8, "low_pct": 5 },
    "fee":    { "provider_pct": 23.08, "flat_baht": 1.07 }
  }
NULL → use code defaults from DEFAULT_PAYLATER_CONFIG (src/lib/money.js).
Partial objects are deep-merged with the defaults at read time, so a
config that omits any subtree still works.';
