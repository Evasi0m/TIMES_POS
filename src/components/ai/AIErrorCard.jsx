// AIErrorCard — pretty error renderer for the AI bill-scan flow.
//
// Two exports:
//   parseAIError(err): async — turn any error (supabase-js
//      FunctionsHttpError, fetch failure, plain Error) into a
//      structured `AIError` object with severity + Thai title + body
//      + actionable hint. Async because FunctionsHttpError exposes its
//      body via context.text() which returns a Promise.
//
//   <AIErrorCard error={...} onRetry={...} onDismiss={...} />
//      Renders the AIError as a card with the right colour + icon +
//      action buttons, replacing the plain whitespace-pre-wrap divs
//      we used to dump raw error.message into.
//
// Error taxonomy (`kind`):
//   quota    — Gemini RPD / RPM exhausted (HTTP 429)
//   overload — Google's servers are too busy (HTTP 503)
//   timeout  — function or upstream timed out (HTTP 504)
//   server   — Gemini internal error (HTTP 500)
//   gateway  — networking issue between supabase and Gemini (HTTP 502)
//   auth     — admin-only, API key missing/invalid (HTTP 401/403)
//   payload  — image too large for the edge fn (HTTP 413)
//   bad_req  — request shape rejected (HTTP 400)
//   network  — browser couldn't even reach supabase (TypeError fetch failed)
//   data     — got 200 OK but the body didn't make sense (empty bills, etc.)
//   unknown  — fell off the end of all known cases
//
// Each kind has a `severity`:
//   info     — Google's problem, will resolve itself, just retry
//   warning  — User can fix locally (smaller image, fewer bills, wait)
//   danger   — Needs admin attention (auth, quota run-out)
//
// We deliberately avoid leaking technical jargon like "FunctionsHttpError"
// or "UNAVAILABLE" into the title/body — those go into the collapsible
// "รายละเอียดเทคนิค" footer for the admin to copy-paste if they need it.

import React, { useState } from 'react';
import Icon from '../ui/Icon.jsx';

// ─── Parse ────────────────────────────────────────────────────────────
export async function parseAIError(err) {
  // 1. supabase-js FunctionsHttpError carries the real HTTP context on
  //    `err.context`. Drilling in lets us see Gemini's structured
  //    response body (the edge fn forwards `{error, detail}`).
  let status = 0;
  let body = null;
  try {
    const ctx = err?.context;
    if (ctx && typeof ctx.status === 'number') {
      status = ctx.status;
      const text = await ctx.text();
      try { body = JSON.parse(text); }
      catch { body = { error: text }; }
    }
  } catch (_) { /* swallow — fall through to status==0 branch */ }

  // Pull the Gemini status word ("UNAVAILABLE", "RESOURCE_EXHAUSTED",
  // etc.) out of the nested detail string so we can show it as
  // technical info for admin troubleshooting.
  const geminiStatus = extractGeminiStatus(body);

  // ── HTTP-status-based mapping ──────────────────────────────────────
  if (status === 429) {
    return {
      kind: 'quota',
      severity: 'danger',
      icon: 'zap',
      title: 'AI โควต้าหมดวันนี้',
      // v6+: cascade now covers multiple keys × multiple models.
      // "ทุก key ในระบบใช้ครบโควต้าแล้ว" is accurate regardless of how
      // many keys the admin has registered — they're all exhausted.
      body: 'ทุก API key ในระบบใช้ครบโควต้าวันนี้แล้ว (ทั้ง Gemini 3 Flash และ 2.5 Flash)',
      hint: 'เพิ่ม API key อีกตัวที่ Settings → AI (ขอฟรีที่ aistudio.google.com/apikey) หรือรอถึงเที่ยงคืน Pacific Time (~14:00 เวลาไทย) ให้โควต้ารีเซ็ต',
      retryable: false,
      detail: geminiStatus || body?.detail || null,
      rawStatus: status,
    };
  }
  if (status === 503) {
    return {
      kind: 'overload',
      severity: 'info',
      icon: 'refresh',
      title: 'AI งานเข้าเยอะเกินไป',
      body: 'เซิร์ฟเวอร์ AI ของ Google กำลังรับงานหนัก ไม่ได้เป็นปัญหาที่ร้าน',
      hint: 'รอ 1-2 นาทีแล้วกดลองอีกครั้ง โดยทั่วไประบบจะกลับมาเร็ว',
      retryable: true,
      detail: geminiStatus || null,
      rawStatus: status,
    };
  }
  if (status === 504) {
    return {
      kind: 'timeout',
      severity: 'warning',
      icon: 'refresh',
      title: 'AI ใช้เวลาประมวลผลนานเกิน',
      body: 'รูปอาจจะใหญ่หรือซับซ้อนเกินไป จนเซิร์ฟเวอร์ตัดการเชื่อมต่อก่อนได้คำตอบ',
      hint: 'ลองลดจำนวนบิลต่อรอบ (5 บิลแทน 10) หรือถ่ายรูปใหม่ให้ชัดขึ้น',
      retryable: true,
      detail: geminiStatus || null,
      rawStatus: status,
    };
  }
  if (status === 500) {
    return {
      kind: 'server',
      severity: 'info',
      icon: 'alert',
      title: 'AI ของ Google ขัดข้อง',
      body: 'เป็นปัญหาภายในเซิร์ฟเวอร์ Google ไม่ได้เป็นที่ร้าน',
      hint: 'ลองอีกครั้งสักครู่ ถ้ายังเกิดต่อ ดูสถานะที่ status.cloud.google.com',
      retryable: true,
      detail: geminiStatus || body?.detail || null,
      rawStatus: status,
    };
  }
  if (status === 502) {
    return {
      kind: 'gateway',
      severity: 'warning',
      icon: 'alert',
      title: 'ติดต่อ AI ไม่ได้',
      body: 'การเชื่อมต่อระหว่างเซิร์ฟเวอร์ของร้านกับ AI ของ Google มีปัญหา',
      hint: 'ตรวจสอบอินเทอร์เน็ตที่ร้าน แล้วกดลองใหม่',
      retryable: true,
      detail: geminiStatus || null,
      rawStatus: status,
    };
  }
  if (status === 401 || status === 403) {
    return {
      kind: 'auth',
      severity: 'danger',
      icon: 'lock',
      title: 'ไม่มีสิทธิ์ใช้ AI',
      body: (body?.error && typeof body.error === 'string')
        ? body.error
        : 'Gemini API key อาจหมดอายุ ตั้งค่าผิด หรือบัญชีของคุณไม่ใช่ admin',
      hint: 'ให้ admin ตรวจสอบ API key ที่หน้า การตั้งค่า → AI',
      retryable: false,
      detail: geminiStatus || null,
      rawStatus: status,
    };
  }
  if (status === 413) {
    return {
      kind: 'payload',
      severity: 'warning',
      icon: 'alert',
      title: 'รูปบิลใหญ่เกินไป',
      body: 'ไฟล์รูปเกินขนาดที่เซิร์ฟเวอร์รับได้ (6 MB) — น่าจะเป็นเพราะกล้องตั้งความละเอียดไว้สูงมาก',
      hint: 'ถ่ายใหม่ที่ความละเอียดต่ำลง หรือใช้กล้องในแอป (กดปุ่ม "ถ่ายจากกล้อง" จะปรับขนาดให้อัตโนมัติ)',
      retryable: false,
      detail: null,
      rawStatus: status,
    };
  }
  if (status === 400) {
    return {
      kind: 'bad_req',
      severity: 'warning',
      icon: 'alert',
      title: 'คำขอผิดรูปแบบ',
      body: (body?.error && typeof body.error === 'string')
        ? body.error
        : 'ระบบส่งคำขอที่เซิร์ฟเวอร์ไม่เข้าใจ — น่าจะเป็นบั๊กของแอป',
      hint: 'ลองรีโหลดหน้าเว็บ ถ้ายังเกิดต่อ แจ้งผู้ดูแลระบบ',
      retryable: false,
      detail: geminiStatus || null,
      rawStatus: status,
    };
  }

  // ── Network / non-HTTP failures ────────────────────────────────────
  // supabase-js wraps fetch errors as FunctionsFetchError with name
  // starting with 'FunctionsFetch'. TypeError from native fetch when
  // there's no DNS/network. Either way: browser couldn't reach us.
  const errName = String(err?.name || '');
  const errMsg = String(err?.message || '');
  if (
    errName.startsWith('FunctionsFetch') ||
    errName === 'TypeError' ||
    /failed to fetch|network|networkerror/i.test(errMsg)
  ) {
    return {
      kind: 'network',
      severity: 'warning',
      icon: 'alert',
      title: 'ออนไลน์ไม่ติด',
      body: 'เบราว์เซอร์ติดต่อเซิร์ฟเวอร์ของร้านไม่ได้',
      hint: 'ตรวจสอบสัญญาณ WiFi / 4G ที่ร้าน แล้วกดลองใหม่',
      retryable: true,
      detail: errMsg || null,
      rawStatus: 0,
    };
  }

  // ── Data-shape failures (we got a 200 but the body was weird) ──────
  // These come from BulkReceiveView's own checks: empty bills array,
  // missing data, etc. The thrown Error.message contains a Thai string
  // we authored, so it's safe to surface directly.
  if (errMsg && /ไม่ได้รับข้อมูล|ไม่ได้รีเทิร์น|ไม่มีรายการ/.test(errMsg)) {
    return {
      kind: 'data',
      severity: 'warning',
      icon: 'alert',
      title: 'AI อ่านบิลไม่ได้',
      body: errMsg,
      hint: 'ตรวจดูว่ารูปเป็นบิล CMG จริง ภาพชัด ไม่เบลอ และไม่มีอะไรบังเลขรายการ',
      retryable: true,
      detail: null,
      rawStatus: status,
    };
  }

  // ── Anything else ──────────────────────────────────────────────────
  return {
    kind: 'unknown',
    severity: 'danger',
    icon: 'alert',
    title: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    body: body?.error || errMsg || 'ระบบไม่สามารถระบุสาเหตุได้',
    hint: 'ลองรีโหลดหน้าเว็บแล้วลองใหม่ ถ้ายังเกิดต่อ แจ้งผู้ดูแลระบบ',
    retryable: true,
    detail: geminiStatus || body?.detail || null,
    rawStatus: status,
  };
}

function extractGeminiStatus(body) {
  if (!body?.detail || typeof body.detail !== 'string') return null;
  const m = body.detail.match(/"status"\s*:\s*"([A-Z_]+)"/);
  return m ? m[1] : null;
}

// ─── Severity → visual tokens ─────────────────────────────────────────
// Two-level palette plus a halo on the icon — danger gets a stronger
// accent because the user can't proceed (auth/quota), warning is yellow
// for things the user can fix, info is blue for "wait it out".
const SEVERITY_META = {
  danger: {
    cardCls: 'bg-error/8 border-error/30',
    iconWrapCls: 'bg-error/15 border-error/35 text-error',
    titleCls: 'text-error',
    dotCls: 'bg-error',
  },
  warning: {
    cardCls: 'bg-warning/8 border-warning/30',
    iconWrapCls: 'bg-warning/15 border-warning/35 text-warning',
    titleCls: 'text-warning',
    dotCls: 'bg-warning',
  },
  info: {
    cardCls: 'bg-primary/8 border-primary/30',
    iconWrapCls: 'bg-primary/15 border-primary/35 text-primary',
    titleCls: 'text-primary',
    dotCls: 'bg-primary',
  },
};

// ─── UI ───────────────────────────────────────────────────────────────
export default function AIErrorCard({ error, onRetry, onDismiss, onOpenSettings, compact = false }) {
  const [showDetail, setShowDetail] = useState(false);
  if (!error) return null;
  const meta = SEVERITY_META[error.severity] || SEVERITY_META.danger;
  const showRetry = error.retryable && typeof onRetry === 'function';
  const showSettings = error.kind === 'auth' && typeof onOpenSettings === 'function';

  // Compact variant — single-line strip used inside per-bill cards
  // where we can't afford the big icon + buttons. Same severity colour
  // but condensed to one row.
  if (compact) {
    return (
      <div className={`rounded-md border px-2.5 py-1.5 flex items-start gap-2 text-xs ${meta.cardCls}`}>
        <span className={`flex-shrink-0 ${meta.iconWrapCls.match(/text-[a-z]+/)?.[0] || ''} mt-0.5`}>
          <Icon name={error.icon} size={12}/>
        </span>
        <div className="min-w-0 flex-1">
          <span className="font-medium">{error.title}</span>
          {error.body && <span className="text-muted ml-1.5">— {error.body}</span>}
        </div>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="text-muted-soft hover:text-ink flex-shrink-0">
            <Icon name="x" size={12}/>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={
        'rounded-xl border-2 p-4 lg:p-5 flex items-start gap-4 relative overflow-hidden ' +
        meta.cardCls
      }
    >
      {/* Soft halo behind the icon — purely decorative, makes the card
          feel less like a flat error log and more like a status panel */}
      <div
        className={`absolute -top-8 -left-8 w-32 h-32 rounded-full opacity-30 blur-2xl ${meta.dotCls}`}
        aria-hidden="true"
      />

      {/* Icon block */}
      <div
        className={
          'relative flex-shrink-0 w-12 h-12 rounded-xl border flex items-center justify-center ' +
          meta.iconWrapCls
        }
      >
        <Icon name={error.icon} size={24}/>
      </div>

      {/* Text block */}
      <div className="min-w-0 flex-1 relative">
        <div className="flex items-start justify-between gap-2">
          <div className={`font-display text-lg lg:text-xl leading-tight ${meta.titleCls}`}>
            {error.title}
          </div>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="btn-ghost !p-1 -mr-1 -mt-1 text-muted-soft hover:text-ink flex-shrink-0"
              aria-label="ปิด"
            >
              <Icon name="x" size={14}/>
            </button>
          )}
        </div>

        <div className="text-sm text-ink mt-1.5 leading-relaxed">{error.body}</div>

        {error.hint && (
          <div className="mt-2.5 text-sm text-muted leading-relaxed flex items-start gap-1.5">
            <span className="text-muted-soft mt-0.5">→</span>
            <span>{error.hint}</span>
          </div>
        )}

        {/* Action row */}
        {(showRetry || showSettings) && (
          <div className="mt-3.5 flex items-center gap-2 flex-wrap">
            {showRetry && (
              <button type="button" className="btn-primary !py-2 !text-sm" onClick={onRetry}>
                <Icon name="refresh" size={14}/> ลองอีกครั้ง
              </button>
            )}
            {showSettings && (
              <button type="button" className="btn-secondary !py-2 !text-sm" onClick={onOpenSettings}>
                <Icon name="settings" size={14}/> ไปการตั้งค่า AI
              </button>
            )}
          </div>
        )}

        {/* Collapsible technical detail — only renders if we have any.
            Keeps the card uncluttered for cashiers but lets the admin
            grab the Gemini status code when filing a bug. */}
        {(error.detail || error.rawStatus > 0) && (
          <div className="mt-3 pt-3 border-t border-current/15 text-[11px]">
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="text-muted-soft hover:text-ink inline-flex items-center gap-1 font-medium"
            >
              <Icon name={showDetail ? 'chevron-d' : 'chevron-r'} size={10}/>
              รายละเอียดเทคนิค
            </button>
            {showDetail && (
              <div className="mt-1.5 font-mono text-muted-soft space-y-0.5">
                {error.rawStatus > 0 && <div>HTTP {error.rawStatus}</div>}
                {error.detail && (
                  <div className="break-all">{String(error.detail).slice(0, 280)}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
