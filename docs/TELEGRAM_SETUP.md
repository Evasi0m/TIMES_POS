# Telegram Daily Summary — Setup

ระบบส่งสรุปยอดของแต่ละวันเข้า Telegram chat ของเจ้าของร้านอัตโนมัติ.

## ภาพรวม

```
        21:00 BKK ทุกวัน
pg_cron ─────────────────▶ public.invoke_daily_telegram_summary()
                            │
                            ▼ http_post (pg_net)
                  Edge Function: daily-telegram-summary
                            │
                            ▼ select shop_secrets / sale_orders / items / shop_expenses
                            ▼
                            POST api.telegram.org/bot<TOKEN>/sendMessage
```

ทุกๆ ชั่วโมง pg_cron จะเรียก edge function ครั้งหนึ่ง. Edge function จะเช็ค `daily_summary_hour` (ที่ตั้งใน UI) — ถ้าเวลาตรงและ `daily_summary_enabled = true` จะคำนวณสรุปและส่งไป Telegram. ไม่ตรง → return early เงียบๆ. ทำให้ผู้ใช้เปลี่ยนเวลาส่งใน UI ได้โดยไม่ต้องแตะ DDL.

---

## ครั้งแรก — สิ่งที่ต้องทำใน Supabase

ทำครั้งเดียว, จากนั้นปรับ token/chat/เวลา จาก UI ในแอปได้เลย.

### 1. สร้าง Telegram Bot

1. เปิด Telegram → คุยกับ `@BotFather`
2. ส่ง `/newbot` → ตั้งชื่อ → คัดลอก **Bot Token** (รูปแบบ `123456:ABC...`)
3. คุย/ส่งข้อความใด ๆ ให้ bot ของคุณก่อน 1 ครั้ง (จำเป็นเพื่อให้ `getUpdates` มี chat ให้เลือก)

### 2. เก็บ Service-Role JWT ลง Supabase Vault

pg_cron ต้องใช้ service-role JWT เพื่อเรียก edge function ผ่าน HTTP. ทำครั้งเดียว:

```sql
-- ใน Supabase SQL editor, เปลี่ยน <SERVICE_ROLE_JWT> เป็นค่าจริง
-- (ดูจาก Project Settings → API → service_role key)
select vault.create_secret('<SERVICE_ROLE_JWT>', 'service_role_key');
```

ตรวจ:

```sql
select name from vault.secrets where name = 'service_role_key';
-- ควรได้ 1 แถว
```

ถ้าไม่ใส่: cron job จะ run ทุกชั่วโมงแล้ว `RAISE NOTICE` เงียบ ๆ — ไม่ error, ไม่ส่ง Telegram.

### 3. ตั้งค่าใน UI

เข้า TIMES POS → ⚙️ การตั้งค่า → **Telegram — สรุปยอดอัตโนมัติ** (admin only):

1. วาง **Bot Token**
2. กด **"ดู Chat ID จาก bot"** → เลือก chat ที่ต้องการ
3. กด **"บันทึก"**
4. กด **"ทดสอบส่ง"** → ควรเห็นข้อความใน Telegram ทันที
5. กด **"ดูตัวอย่างยอดเมื่อวาน"** → เห็นข้อความ preview ในหน้าจอ
6. เลือกเวลาส่ง (default 21:00 BKK) → เปิดสวิตช์ → บันทึก

### 4. ทดสอบ cron flow แบบเต็ม (ทางเลือก)

```sql
-- เรียก hot path เดียวกับ cron — ควรเห็น http_post กลับมาใน 5–10 วิ
select public.invoke_daily_telegram_summary();

-- ดู cron history
select * from cron.job_run_details order by start_time desc limit 5;
```

---

## ความปลอดภัย

- **Bot Token** อยู่ใน `public.shop_secrets` พร้อม RLS `is_admin()` only.
  Cashier select ไม่ได้ → token ไม่หลุดออกจาก browser ของ admin.
- **Chat ID** ก็อยู่ในตารางเดียวกัน, ระดับเดียวกัน.
- Edge function ใช้ `SUPABASE_SERVICE_ROLE_KEY` (built-in env var) เพื่อ bypass RLS ตอน read/write `shop_secrets`.
- pg_cron เก็บ service-role JWT ใน Supabase Vault (encrypted).

ถ้า bot token รั่วไหล: เปิด @BotFather → `/revoke` → สร้างใหม่ → วางใน UI.

---

## ปรับแต่ง

| ต้องการ | ทำที่ |
|---|---|
| เปลี่ยนเวลาส่ง | UI dropdown "เวลาส่ง" |
| ปิดส่งชั่วคราว | UI switch "การส่งอัตโนมัติ" |
| เปลี่ยนรูปแบบข้อความ | `supabase/functions/daily-telegram-summary/index.ts` → `formatMessage()` → redeploy |
| ส่ง summary ของวันที่อื่น | `POST /functions/v1/daily-telegram-summary` body `{ "date": "2026-05-01" }` |
| เพิ่ม chat รอง | (vNext) แยก `shop_secrets.telegram_chat_id_2` หรือ array |

---

## Troubleshooting

**ไม่ได้รับข้อความเลย**
1. UI Settings → ดู "ส่งล่าสุด" / "ครั้งล่าสุดผิดพลาด"
2. SQL: `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='daily-telegram-summary') order by start_time desc limit 5;`
3. Vault: `select name from vault.secrets where name='service_role_key';` ต้องมี 1 แถว
4. กด "ทดสอบส่ง" ใน UI → ดู error toast

**"missing token or chat_id"**
ยังไม่กด "บันทึก" หลังกรอก. กดบันทึก แล้วทดสอบใหม่.

**"Telegram 401: Unauthorized"**
Token ผิด/หมดอายุ/ถูก revoke — สร้าง bot ใหม่จาก @BotFather

**"Telegram 400: chat not found"**
ส่งข้อความให้ bot ก่อน 1 ครั้ง แล้วกด "ดู Chat ID" ใหม่

**ยอดในข้อความไม่ตรงกับ Dashboard**
Edge function ใช้ logic เดียวกัน (`net_received` สำหรับ ecommerce, `grand_total` สำหรับหน้าร้าน, ตัด VAT เหมือน P&L). ถ้าต่างกันเป็นนาทีๆ — มีบิลใหม่หลังเวลา cutoff. ลองส่งย้อนวันด้วย `{"date":"YYYY-MM-DD"}`
