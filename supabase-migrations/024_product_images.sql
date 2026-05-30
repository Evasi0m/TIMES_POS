-- 024_product_images.sql
-- Captures the `product_images` + `product_image_jobs` schema that was created
-- ad-hoc in the Supabase dashboard, so the repo matches the live database
-- (fixes schema drift — these tables had no migration).
--
-- product_images   : one row per product that we have *tried* to source an
--                    image for. `status='found'` + non-null `image_url` is the
--                    only state the UI treats as "has an image"; everything else
--                    renders the brand-monogram placeholder.
-- product_image_jobs: append-only audit log of each backfill fetch attempt
--                    (who/when/what URL/HTTP status), written by the external
--                    Apps Script (`fetched_by='apps_script'`) and the
--                    `product-image-backfill` edge function (`'edge_fn'`).
--
-- Idempotent: CREATE ... IF NOT EXISTS + DROP/CREATE policies. Running this
-- against the live DB is a no-op; on a fresh DB it recreates the feature.

-- ====================================================================
-- 1. Tables
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.product_images (
  id                 bigserial PRIMARY KEY,
  product_id         bigint NOT NULL UNIQUE REFERENCES public.products(id) ON DELETE CASCADE,
  image_url          text,
  source_url         text,
  source_brand       text NOT NULL CHECK (source_brand IN ('casio','seiko','alba','citizen','manual')),
  source_name        text,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','found','not_found','failed','manual')),
  last_checked_at    timestamptz,
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_manual_override boolean NOT NULL DEFAULT false,
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_image_jobs (
  id            bigserial PRIMARY KEY,
  product_id    bigint REFERENCES public.products(id) ON DELETE CASCADE,
  source_brand  text,
  attempted_url text,
  resolved_url  text,
  status        text CHECK (status IN ('success','http_error','no_og_image','timeout','blocked','skipped')),
  http_status   integer,
  duration_ms   integer,
  error_message text,
  fetched_by    text NOT NULL DEFAULT 'apps_script',
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Backfill helper: quickly find products that still need an image.
CREATE INDEX IF NOT EXISTS idx_product_images_status ON public.product_images(status);
CREATE INDEX IF NOT EXISTS idx_product_image_jobs_product ON public.product_image_jobs(product_id);

-- ====================================================================
-- 2. Row Level Security
-- ====================================================================
-- Read: any authenticated user (the POS app reads image_url to render thumbs).
-- Write: admins only (the edge function uses the service_role key, which
--        bypasses RLS, so backfill writes are unaffected).
ALTER TABLE public.product_images     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_image_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read ON public.product_images;
CREATE POLICY authenticated_read ON public.product_images
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS admin_write ON public.product_images;
CREATE POLICY admin_write ON public.product_images
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS authenticated_read ON public.product_image_jobs;
CREATE POLICY authenticated_read ON public.product_image_jobs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS admin_write ON public.product_image_jobs;
CREATE POLICY admin_write ON public.product_image_jobs
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
