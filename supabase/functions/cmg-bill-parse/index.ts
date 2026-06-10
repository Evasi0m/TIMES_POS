// CMG bill parser v7 — multi-key pool + model cascade + per-item needs_review.
//
// Accepts one OR many base64-encoded photos of Central Trading (CMG)
// supplier invoices, sends them to Gemini in ONE request with a strict
// JSON-schema response, and returns an array of parsed bills + aggregate
// token usage.
//
// ─── What's new in v6 vs v5 ─────────────────────────────────────────
// v5 read a single API key from `shop_secrets.gemini_api_key`. When that
// key hit its 250 RPD free-tier limit, the whole shop was dead until
// midnight PT. Migration 016 introduces `ai_api_keys` — admins can now
// register N keys and we cascade through them in priority order.
//
// Cascade strategy is MODEL-FIRST, KEY-SECOND:
//
//    for each model (gemini-2.5-flash, gemini-3-flash-preview):
//      for each key (priority ASC):
//         try (key, model)
//         on 429/5xx → mark key.last_error, try next combo
//         on 401/403 → mark key bad, try next KEY (skip this key's models)
//         on success → stamp key.last_used_at, log + return
//
// Why model-first? The shop may register many API keys. If key 1's
// primary-model request overloads or times out, we should try key 2 on
// the same fast/cheap GA model before falling back to the preview model.
// This uses the key pool as intended and keeps the slower fallback model
// as a true last resort.
//
// Why this lives in an Edge Function:
//   The Gemini API keys are admin-only sensitive material. If we let the
//   browser fetch them from ai_api_keys and call Gemini directly, the
//   keys end up in network logs / devtools of every admin device. By
//   proxying through this function with service_role we keep the keys
//   strictly server-side; the browser only ever sees its own user JWT.
//
// Auth: `verify_jwt = true`. The function then double-checks the caller
// is an admin via the database (so a cashier with a stolen JWT can't
// burn the shop's API quota).
//
// Body shapes accepted (frontend may send either):
//   Batch (new): { images: [{ image_base64, mime }, ...] }   // max 10
//   Single (legacy): { image_base64, mime }
//
// Response (200):
//   {
//     bills: [
//       { is_cmg_bill, supplier_invoice_no, items: [{model_code,quantity,unit_cost}] },
//       ...
//     ],
//     usage: { prompt_tokens, output_tokens, total_tokens,
//              estimated_usd, estimated_thb, model, bills_count,
//              key_label }
//   }
//
// Error responses preserve the upstream status code so the frontend can
// map them to friendly Thai messages:
//   429 → ALL (key × model) combos quota-exhausted
//   503 → all combos overloaded (less likely now that we have keys)
//   500/504 → all combos had server errors
//   502 → we couldn't reach / parse Gemini at all
//   400/401/403/413 → caller / config problem

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;

const MAX_BILLS_PER_BATCH = 10;
const MAX_BASE64_PER_IMAGE = 8 * 1024 * 1024; // ~6 MB after decode
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const REQUEST_BUDGET_MS = 130_000; // leave room before Supabase's 150s idle timeout
const GEMINI_ATTEMPT_TIMEOUT_MS = 35_000;
const MIN_ATTEMPT_REMAINING_MS = 8_000;

// Model cascade. First entry is tried first within a given key; on 429
// or 5xx we step to the next model. Per-model pricing is colocated so
// the audit log records the rate that was actually charged.
// Source: https://ai.google.dev/gemini-api/docs/pricing (2026-05)
//
// Order rationale (changed 2026-06): the GA `gemini-2.5-flash` is tried
// FIRST because the `gemini-3-flash-preview` capacity became unreliable —
// it started returning 503 "overloaded" on nearly every call, which both
// slowed every scan (wait for the preview 503, THEN fall back) and made
// the whole request fail whenever 2.5 was momentarily busy too. 2.5-flash
// is GA, faster to respond, ~7× cheaper, and accurate enough for this OCR
// task. The preview model stays as a secondary fallback.
const MODELS = [
  { id: 'gemini-2.5-flash',       priceInUsdPerM: 0.075, priceOutUsdPerM: 0.30 },
  { id: 'gemini-3-flash-preview', priceInUsdPerM: 0.50,  priceOutUsdPerM: 3.00 },
];
const USD_TO_THB = 36;

const PROMPT = `You are reading one or more Thai supplier invoices from "Central Trading Co., Ltd." (CMG / บริษัท เซ็นทรัลเทรดดิ้ง จำกัด). Each input image is a separate bill. Extract them into a JSON array — one entry per image — matching the schema.

Rules:
1. For each bill, confirm the bill header includes "Central Trading" or "เซ็นทรัลเทรดดิ้ง". If it does NOT, set is_cmg_bill=false for that bill and return an empty items array for it.
2. Read each bill's invoice number from the "เลขที่:" field at the top-right (10-digit code, NOT the barcode or SKU).
3. For each product row inside a bill, extract:
   - model_code: the รหัสสินค้า / รุ่น text. STRIP any leading "CE " prefix (CMG prepends it but our database stores models without it). Example: "CE LTP-1302DS-4AVDF" → "LTP-1302DS-4AVDF".
   - quantity:   integer in the จำนวน column (the printed number, ignore handwritten checkmarks).
   - unit_cost:  the ราคา/หน่วย column. Numbers use comma thousands separator — parse "1,138.32" as 1138.32. This is the PRE-VAT cost per single piece.
4. IGNORE any handwritten pen/pencil marks overlaying the printed numbers — only read printed values.
5. NEVER calculate or infer numbers. Always return your best reading of the printed value. Use 0 ONLY when there is truly no printed number to read at all.
6. For EACH item set needs_review=true when you are NOT confident about model_code, quantity, or unit_cost — e.g. the print is blurry/cut off, a handwritten mark overlaps the digits, glare obscures it, or you had to guess between similar characters (0/O, 1/7, 8/B). Otherwise set needs_review=false. Still return your best reading either way; needs_review just flags it for a human to double-check.
7. The number of rows per bill MUST equal the number of printed item rows on that bill.
8. The output array MUST have exactly one entry per input image, in the SAME ORDER as the images were provided. Do NOT reorder, merge, or drop bills.

Return JSON matching the schema. No prose.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    bills: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          is_cmg_bill:         { type: 'BOOLEAN' },
          supplier_invoice_no: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                model_code:   { type: 'STRING' },
                quantity:     { type: 'INTEGER' },
                unit_cost:    { type: 'NUMBER' },
                needs_review: { type: 'BOOLEAN' },
              },
              required: ['model_code', 'quantity', 'unit_cost', 'needs_review'],
            },
          },
        },
        required: ['is_cmg_bill', 'supplier_invoice_no', 'items'],
      },
    },
  },
  required: ['bills'],
};

interface ImagePart {
  image_base64: string;
  mime: string;
}
interface ReqBody {
  images?: ImagePart[];
  image_base64?: string;
  mime?: string;
}
interface ApiKeyRow {
  id: string;
  label: string;
  api_key: string;
}

function j(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// Outcomes from a single Gemini attempt.
//   `transient`  → 429 / 5xx — safe to try next (model or key)
//   `badKey`     → 401 / 403 — this key is bad, skip rest of its models
//   `clientErr`  → other 4xx — our request is malformed; don't retry
//   `network`    → fetch threw — connectivity issue, won't help to retry
//   `parseError` → envelope unreadable from Gemini
type Attempt =
  | { kind: 'ok'; rawText: string; promptTokens: number; outputTokens: number; elapsedMs: number }
  | { kind: 'transient'; status: number; detail: string }
  | { kind: 'badKey'; status: number; detail: string }
  | { kind: 'clientErr'; status: number; detail: string }
  | { kind: 'network'; detail: string }
  | { kind: 'parseError'; detail: string };

async function callGemini(
  modelId: string,
  apiKey: string,
  images: ImagePart[],
  timeoutMs = GEMINI_ATTEMPT_TIMEOUT_MS,
): Promise<Attempt> {
  const startedAt = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts: any[] = images.map((img) => ({
    inline_data: { mime_type: img.mime, data: img.image_base64 },
  }));
  parts.push({ text: PROMPT });

  const body = {
    contents: [{ role: 'user', parts }],
    generation_config: {
      response_mime_type: 'application/json',
      response_schema: RESPONSE_SCHEMA,
      temperature: 0,
      max_output_tokens: 16384,
    },
  };

  let res: Response;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort('gemini-timeout'), timeoutMs);
  try {
    res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal,
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      return {
        kind: 'transient',
        status: 504,
        detail: `Gemini request timeout after ${timeoutMs}ms`,
      };
    }
    return { kind: 'network', detail: String(e) };
  } finally {
    clearTimeout(timeout);
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) {
      return { kind: 'transient', status: res.status, detail: text.slice(0, 500) };
    }
    if (res.status === 401 || res.status === 403) {
      return { kind: 'badKey', status: res.status, detail: text.slice(0, 500) };
    }
    return { kind: 'clientErr', status: res.status, detail: text.slice(0, 500) };
  }

  let parsed: any;
  try { parsed = JSON.parse(text); }
  catch { return { kind: 'parseError', detail: 'non-JSON envelope' }; }

  const usage = parsed?.usageMetadata || {};
  const promptTokens = Number(usage.promptTokenCount)     || 0;
  const outputTokens = Number(usage.candidatesTokenCount) || 0;
  const rawText: string = parsed?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!rawText) {
    return { kind: 'parseError', detail: 'empty candidate text' };
  }
  return { kind: 'ok', rawText, promptTokens, outputTokens, elapsedMs: Date.now() - startedAt };
}

// Classify a transient / badKey status into a short Thai-friendly
// string we write to ai_api_keys.last_error so the UI can display
// something sensible without parsing upstream JSON.
function shortError(status: number, detail: string): string {
  if (status === 429) return 'quota exhausted (429)';
  if (status === 401) return 'unauthorized (401) — key invalid or revoked';
  if (status === 403) return 'forbidden (403) — key disabled or wrong scope';
  if (status === 504 && /timeout/i.test(detail)) return 'Gemini timed out (504)';
  if (status === 503) return 'Gemini overloaded (503)';
  if (status >= 500)  return `Gemini server error (${status})`;
  const trimmed = detail.trim().slice(0, 120);
  return `${status}: ${trimmed}`;
}

function requestId() {
  try { return crypto.randomUUID(); }
  catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
}

function imageStats(images: ImagePart[]) {
  const sizes = images.map((img) => img.image_base64?.length || 0);
  const total = sizes.reduce((sum, n) => sum + n, 0);
  return {
    total_base64_chars: total,
    max_base64_chars: sizes.length ? Math.max(...sizes) : 0,
  };
}

Deno.serve(async (req: Request) => {
  const reqId = requestId();
  const requestStartedAt = Date.now();
  const deadlineAt = requestStartedAt + REQUEST_BUDGET_MS;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return j(405, { error: 'method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return j(401, { error: 'missing JWT' });

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes?.user) return j(401, { error: 'invalid JWT' });
  const userId = userRes.user.id;

  const { data: isAdminData, error: isAdminErr } = await userClient.rpc('is_admin');
  if (isAdminErr) return j(500, { error: 'admin check failed: ' + isAdminErr.message });
  if (!isAdminData) return j(403, { error: 'admin only' });

  // Master switch still lives in shop_secrets (per-shop setting, not
  // per-key) — this lets an admin disable the feature entirely without
  // having to nuke every key.
  const { data: secrets, error: secretsErr } = await adminClient
    .from('shop_secrets').select('ai_bill_scan_enabled')
    .eq('id', 1).maybeSingle();
  if (secretsErr) return j(500, { error: 'cannot load secrets: ' + secretsErr.message });
  if (!secrets?.ai_bill_scan_enabled) {
    return j(400, { error: 'AI bill scan disabled in settings' });
  }

  // Load key pool. Disabled keys are filtered out; ties on priority
  // broken by insertion order so new keys don't cut in line.
  const { data: keys, error: keysErr } = await adminClient
    .from('ai_api_keys')
    .select('id, label, api_key')
    .eq('disabled', false)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true });
  if (keysErr) return j(500, { error: 'cannot load keys: ' + keysErr.message });
  if (!keys || keys.length === 0) {
    return j(400, { error: 'ยังไม่มี API key ใน pool — ไป Settings → AI เพื่อเพิ่ม' });
  }

  let body: ReqBody;
  try { body = await req.json(); }
  catch { return j(400, { error: 'invalid JSON body' }); }

  // Normalize input: accept either batch shape or legacy single shape.
  let images: ImagePart[];
  if (Array.isArray(body.images)) {
    images = body.images;
  } else if (body.image_base64 && body.mime) {
    images = [{ image_base64: body.image_base64, mime: body.mime }];
  } else {
    return j(400, { error: 'must provide either `images: [...]` or `image_base64` + `mime`' });
  }

  if (images.length === 0) {
    return j(400, { error: 'images array is empty' });
  }
  if (images.length > MAX_BILLS_PER_BATCH) {
    return j(400, { error: `จำนวนบิลมากเกิน — สูงสุด ${MAX_BILLS_PER_BATCH} บิล/รอบ (ส่งมา ${images.length})` });
  }

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img?.image_base64 || typeof img.image_base64 !== 'string') {
      return j(400, { error: `รูปที่ ${i + 1}: ขาด image_base64` });
    }
    if (!img.mime || !ALLOWED_MIMES.includes(img.mime)) {
      return j(400, { error: `รูปที่ ${i + 1}: mime ต้องเป็น ${ALLOWED_MIMES.join(' / ')}` });
    }
    if (img.image_base64.length > MAX_BASE64_PER_IMAGE) {
      return j(413, { error: `รูปที่ ${i + 1} ใหญ่เกินไป — จำกัด ~6 MB ต่อรูป` });
    }
  }

  const stats = imageStats(images);
  console.info('[cmg-bill-parse] start', {
    req_id: reqId,
    bills_count: images.length,
    ...stats,
  });

  // Model-first cascade. Every failure bumps ai_api_keys.last_error so
  // the operator can see in the UI why a given key was skipped.
  let lastTransient: { status: number; detail: string } | null = null;
  const badKeyIds = new Set<string>();
  const trace: string[] = [];

  for (const m of MODELS) {
    for (const k of keys as ApiKeyRow[]) {
      if (badKeyIds.has(k.id)) continue;
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs < MIN_ATTEMPT_REMAINING_MS) {
        console.warn('[cmg-bill-parse] request budget exhausted', {
          req_id: reqId,
          remaining_ms: remainingMs,
          last_status: lastTransient?.status ?? null,
        });
        return j(504, {
          error: 'AI ใช้เวลานานเกินไปก่อนลอง API key ครบทุกตัว',
          detail: `request budget exhausted; req_id=${reqId}; last=${lastTransient?.detail ?? 'none'}`,
          req_id: reqId,
          trace,
        });
      }

      const attemptTimeoutMs = Math.max(
        MIN_ATTEMPT_REMAINING_MS,
        Math.min(GEMINI_ATTEMPT_TIMEOUT_MS, remainingMs - 3_000),
      );
      const attemptStartedAt = Date.now();
      const attempt = await callGemini(m.id, k.api_key, images, attemptTimeoutMs);
      const attemptMs = Date.now() - attemptStartedAt;
      const keyLabel = k.label || 'unlabeled';

      if (attempt.kind === 'transient') {
        lastTransient = { status: attempt.status, detail: attempt.detail };
        const shortMsg = shortError(attempt.status, attempt.detail);
        console.warn('[cmg-bill-parse] transient attempt failed', {
          req_id: reqId,
          key_label: keyLabel,
          model: m.id,
          status: attempt.status,
          attempt_ms: attemptMs,
          detail: attempt.detail.slice(0, 180),
        });
        // Stamp last_error — useful for "why was this key skipped"
        // diagnostics. We intentionally don't clear it on subsequent
        // successes with OTHER keys; only a success on this key itself
        // does (see below).
        await adminClient.from('ai_api_keys').update({
          last_error: shortMsg,
          last_error_at: new Date().toISOString(),
        }).eq('id', k.id);
        await logUsage(
          adminClient, userId, k.id, m.id, images.length, 0, 0, false,
          `${keyLabel} · ${m.id} · ${shortMsg} · attempt_ms=${attemptMs} · req_id=${reqId}`,
        );
        trace.push(`ลอง ${keyLabel} · ${m.id} ไม่ได้ (${shortMsg}) → สลับ key`);
        continue; // try next key on the same model first
      }

      if (attempt.kind === 'badKey') {
        const shortMsg = shortError(attempt.status, attempt.detail);
        console.warn('[cmg-bill-parse] bad key attempt failed', {
          req_id: reqId,
          key_label: keyLabel,
          model: m.id,
          status: attempt.status,
          attempt_ms: attemptMs,
        });
        await adminClient.from('ai_api_keys').update({
          last_error: shortMsg,
          last_error_at: new Date().toISOString(),
        }).eq('id', k.id);
        await logUsage(
          adminClient, userId, k.id, m.id, images.length, 0, 0, false,
          `${keyLabel} · ${m.id} · ${shortMsg} · attempt_ms=${attemptMs} · req_id=${reqId}`,
        );
        trace.push(`${keyLabel} ใช้ไม่ได้ (${shortMsg}) → ข้าม key นี้`);
        badKeyIds.add(k.id);
        continue;
      }

      // These are terminal for the WHOLE request — no point burning
      // the rest of the pool on the same bad user input.
      if (attempt.kind === 'network') {
        await logUsage(adminClient, userId, k.id, m.id, images.length, 0, 0, false, `network: ${attempt.detail} · attempt_ms=${attemptMs} · req_id=${reqId}`);
        return j(502, { error: 'cannot reach Gemini: ' + attempt.detail, req_id: reqId, trace });
      }
      if (attempt.kind === 'clientErr') {
        await logUsage(adminClient, userId, k.id, m.id, images.length, 0, 0, false, `client ${attempt.status}: ${attempt.detail.slice(0, 200)} · attempt_ms=${attemptMs} · req_id=${reqId}`);
        return j(attempt.status, { error: `Gemini rejected request (${attempt.status})`, detail: attempt.detail, req_id: reqId, trace });
      }
      if (attempt.kind === 'parseError') {
        await logUsage(adminClient, userId, k.id, m.id, images.length, 0, 0, false, `envelope: ${attempt.detail} · attempt_ms=${attemptMs} · req_id=${reqId}`);
        return j(502, { error: 'Gemini returned non-JSON envelope', detail: attempt.detail, req_id: reqId, trace });
      }

      // attempt.kind === 'ok' — parse inner JSON and return.
      const { rawText, promptTokens, outputTokens } = attempt;
      let result: { bills?: any[] };
      try { result = JSON.parse(rawText); }
      catch (e) {
        await logUsage(adminClient, userId, k.id, m.id, images.length, promptTokens, outputTokens, false, `bad inner JSON: ${rawText.slice(0, 200)} · attempt_ms=${attemptMs} · req_id=${reqId}`);
        return j(502, { error: 'Gemini returned malformed JSON', detail: rawText.slice(0, 500), req_id: reqId });
      }

      const billsRaw = Array.isArray(result?.bills) ? result.bills : [];
      if (billsRaw.length === 0) {
        await logUsage(adminClient, userId, k.id, m.id, images.length, promptTokens, outputTokens, false, `empty bills array · attempt_ms=${attemptMs} · req_id=${reqId}`);
        return j(502, { error: 'Gemini ไม่ได้รีเทิร์นบิลใดเลย — ลองถ่ายรูปใหม่', req_id: reqId });
      }

      const bills = images.map((_, idx) => {
        const b = billsRaw[idx] || {};
        const items = Array.isArray(b.items) ? b.items.map((x: any) => ({
          model_code:   String(x?.model_code ?? '').trim(),
          quantity:     Math.max(0, Math.round(Number(x?.quantity) || 0)),
          unit_cost:    Math.max(0, Number(x?.unit_cost) || 0),
          needs_review: Boolean(x?.needs_review),
        })).filter((x: any) => x.model_code) : [];
        return {
          is_cmg_bill:         Boolean(b.is_cmg_bill),
          supplier_invoice_no: String(b.supplier_invoice_no ?? '').trim(),
          items,
        };
      });

      const estUsd =
        (promptTokens / 1_000_000) * m.priceInUsdPerM +
        (outputTokens / 1_000_000) * m.priceOutUsdPerM;
      const estThb = estUsd * USD_TO_THB;

      // Stamp the key: success clears its last_error and updates
      // last_used_at. The UI uses these to show "เพิ่งใช้ 2 นาที
      // ที่แล้ว" vs "ไม่ได้ใช้วันนี้".
      await adminClient.from('ai_api_keys').update({
        last_used_at: new Date().toISOString(),
        last_error: null,
        last_error_at: null,
      }).eq('id', k.id);

      console.info('[cmg-bill-parse] success', {
        req_id: reqId,
        key_label: keyLabel,
        model: m.id,
        attempt_ms: attemptMs,
        total_ms: Date.now() - requestStartedAt,
        bills_count: images.length,
      });

      await logUsage(adminClient, userId, k.id, m.id, images.length, promptTokens, outputTokens, true, `attempt_ms=${attemptMs} · req_id=${reqId}`, estUsd, estThb);

      const attemptSecs = Math.max(1, Math.round(attemptMs / 1000));
      trace.push(`${keyLabel} · ${m.id} อ่านสำเร็จ (${attemptSecs} วิ)`);

      return j(200, {
        bills,
        req_id: reqId,
        trace,
        usage: {
          prompt_tokens: promptTokens,
          output_tokens: outputTokens,
          total_tokens:  promptTokens + outputTokens,
          estimated_usd: Number(estUsd.toFixed(6)),
          estimated_thb: Number(estThb.toFixed(4)),
          model: m.id,
          bills_count: bills.length,
          key_label: k.label || '',
        },
      });
    }
  }

  // Every key × every model failed with transient. Forward the most
  // recent status so the frontend can pick the right friendly message.
  const status = lastTransient?.status ?? 503;
  return j(status, {
    error: `Gemini ${status} — ทุก key / model ไม่พร้อมใช้งาน`,
    detail: `${lastTransient?.detail ?? 'unknown'}; req_id=${reqId}`,
    req_id: reqId,
    trace,
    hint: 'ตรวจสอบว่า API key ทุกตัวใน Settings → AI ยังใช้งานได้ หรือรอจนโควต้ารีเซ็ต (เที่ยงคืน Pacific Time)',
  });
});

async function logUsage(
  supa: any,
  userId: string,
  apiKeyId: string | null,
  modelId: string,
  billsCount: number,
  promptTokens: number,
  outputTokens: number,
  ok: boolean,
  errorMessage: string | null,
  estUsd = 0,
  estThb = 0,
) {
  try {
    await supa.from('ai_usage_log').insert({
      user_id: userId,
      api_key_id: apiKeyId,
      feature: 'cmg_bill_scan',
      model: modelId,
      prompt_tokens: promptTokens,
      output_tokens: outputTokens,
      estimated_usd: estUsd,
      estimated_thb: estThb,
      ok,
      error_message: errorMessage
        ? `bills=${billsCount} ${errorMessage}`
        : (billsCount > 1 ? `bills=${billsCount}` : null),
    });
  } catch (e) {
    console.error('[cmg-bill-parse] usage log failed:', e);
  }
}
