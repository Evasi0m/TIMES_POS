#!/usr/bin/env node
/** Copy product-images bucket OLD ? NEW via Storage API. */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(root, '.env.migrate'), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const oldSb = createClient(env.OLD_SUPABASE_URL, env.OLD_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const newSb = createClient(env.NEW_SUPABASE_URL, env.NEW_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BUCKET = 'product-images';

async function ensureBucket() {
  const { data: buckets } = await newSb.storage.listBuckets();
  if (!buckets?.some((b) => b.id === BUCKET)) {
    const { error } = await newSb.storage.createBucket(BUCKET, { public: true });
    if (error) throw error;
  }
}

async function main() {
  await ensureBucket();
  const { data: files, error } = await oldSb.storage.from(BUCKET).list('', { limit: 1000 });
  if (error) throw error;
  let n = 0;
  for (const f of files || []) {
    if (!f.name || f.name.endsWith('/')) continue;
    const path = f.name;
    const { data: blob, error: dlErr } = await oldSb.storage.from(BUCKET).download(path);
    if (dlErr) { console.warn('skip', path, dlErr.message); continue; }
    const { error: upErr } = await newSb.storage.from(BUCKET).upload(path, blob, {
      contentType: 'image/png',
      upsert: true,
    });
    if (upErr) throw upErr;
    n++;
    if (n % 50 === 0) console.log(`  ${n} files…`);
  }
  console.log(`? Copied ${n} files to ${BUCKET}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
