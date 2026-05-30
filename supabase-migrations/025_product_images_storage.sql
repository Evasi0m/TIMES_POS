-- 025_product_images_storage.sql
-- Storage bucket that hosts background-removed product thumbnails (transparent
-- PNGs) produced by the `product-image-backfill` edge function.
--
-- Why a bucket: brand CDNs (casio.com, albawatches.com) don't send CORS headers,
-- so the white background can't be stripped in the browser (<canvas> taints).
-- The edge function fetches + processes server-side and uploads the result here;
-- product_images.image_url then points at the public URL of this bucket.
--
-- The edge function also creates this bucket at runtime (ensureBucket), so this
-- migration is belt-and-suspenders / documentation. Idempotent.

-- Public bucket: rendered <img> loads the PNG directly, no signed URL needed.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Public buckets are readable through the /object/public/ endpoint without RLS,
-- and the edge function writes with the service_role key (which bypasses RLS),
-- so no policies are strictly required. These make intent explicit and allow a
-- future admin "upload image" UI to write straight from the browser.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product_images_public_read'
  ) THEN
    CREATE POLICY product_images_public_read ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'product-images');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'product_images_admin_write'
  ) THEN
    CREATE POLICY product_images_admin_write ON storage.objects
      FOR ALL TO authenticated
      USING (bucket_id = 'product-images' AND is_admin())
      WITH CHECK (bucket_id = 'product-images' AND is_admin());
  END IF;
END $$;
