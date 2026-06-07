# TikTok Shop → POS — Production Audit Report

**วันที่ตรวจ:** 2026-06-07  
**โปรเจกต์:** `zrymhhkqdcttqsdczfcr`

## สรุปผล

| หัวข้อ | สถานะ | หมายเหตุ |
|--------|--------|----------|
| RPC pending/confirm (040/044) | ✅ | `confirm_tiktok_sale_order`, `get_pending_tiktok_orders`, go-live cutoff ใน import |
| Legacy active tanpa confirmed_at | ✅ | 0 rows |
| Matching super_admin (046) | ✅ | `link_tiktok_item_to_product` ใช้ `is_super_admin()` |
| Product image sync (045) | ✅ | `apply_tiktok_product_image` มีอยู่ |
| Cron poll 5 นาที (043) | ✅ | Applied — `*/5 * * * *` |
| Vault `service_role_key` | ❌ | **ยังไม่ตั้ง** — cron `invoke_tiktok_edge` อาจ skip |
| Edge functions TikTok | ✅ | Deployed (webhook v11, poll v10, dll.) |
| Pending queue | ℹ️ | 35 ออเดอร์ `status=pending` รอยืนยัน |
| Double-entry guard | ✅ | เพิ่ม modal เตือน checkout manual channel=tiktok |
| Telegram filter | ✅ | `applyTikTokReportFilter` align กับ app |
| Unit tests | ✅ | 318 tests pass (+ ecommerce-channels, checkout-guard) |

## Migration status

Migration history ใน Supabase แสดงถึง `033_tiktok_cron` แต่ฟังก์ชัน/RPC จาก 040–046 **มีอยู่ใน DB** (รัน manual ผ่าน SQL Editor)

**Applied ระหว่าง audit นี้:**
- `043_tiktok_poll_cron_5min` — poll 30 นาที → 5 นาที

**Action ที่ admin ต้องทำ:**
```sql
-- ตั้ง vault secret ให้ cron เรียก edge functions ได้
SELECT vault.create_secret('<SERVICE_ROLE_JWT>', 'service_role_key');
```

## QA Scenarios (code + DB verified)

### 5.1 Happy path
- Import post-cutoff → `pending` → ไม่เข้า Dashboard (filter `excludePendingTikTok`)
- Confirm → `active` + `confirmed_at` + stok 1x → เข้ารายงาน + badge "TikTok API"

### 5.2 Double entry
- **ก่อน fix:** checkout manual สำเร็จโดยไม่เตือน
- **หลัง fix:** modal เตือนเมื่อ cart มี product_id ตรงกับ pending API order; kasir ต้อง ack เพื่อ proceed

### 5.3 Cancel
- `pending` → void ไม่ restore stok
- `active` (post-confirm) → void restore stok

### 5.5 PendingNetBell
- Migration 039: API TikTok `net_received_pending=false` — ไม่เข้า bell

## Known gaps (ยังไม่ blocker)

1. **Settlement cron** — filter `net_received_pending=true` + status active → no-op; net ใส่ตอน confirm
2. **Re-sync** — ไม่อัปเดต line items หลัง import ครั้งแรก
3. **Duplicate cron jobs** — `tiktok-token-refresh` + `tiktok-token-refresh-12h`, settlement 2 jobs (legacy)

## Deploy หลัง audit (2026-06-07)

TikTok edge functions มีอยู่แล้วบน production — **ต้อง redeploy** หลังแก้ Telegram filter:

```bash
supabase functions deploy daily-telegram-summary --project-ref zrymhhkqdcttqsdczfcr
supabase functions deploy telegram-send --project-ref zrymhhkqdcttqsdczfcr
```

Frontend: build + deploy ตามปกติ (guard modal + default channel `store`)

- `src/lib/tiktok-checkout-guard.js` — overlap detection
- `src/main.jsx` — guard modal, default channel `store`
- `supabase/functions/_shared/telegram-format.ts` — `applyTikTokReportFilter`
- `supabase/functions/daily-telegram-summary/index.ts` — same filter
- `tests/ecommerce-channels.test.js`, `tests/tiktok-checkout-guard.test.js`
- `docs/TIKTOK_INTEGRATION.md`, `docs/TIKTOK_CASHIER_BRIEF.md`
