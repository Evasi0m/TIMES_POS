# TIMES POS — ระบบภาษี (อ้างอิงเชิงลึก)

เอกสารนี้สรุปการทำงานของระบบ VAT ทั้งหมดใน TIMES POS สำหรับ **บริษัท ไทมส์สโตร์ จำกัด** (จด VAT ภ.พ.01 ลงวันที่ 5 มิ.ย. 2569)

## โมดูลในโค้ด

| ไฟล์ | หน้าที่ |
|------|--------|
| `src/lib/money.js` | `vatBreakdown`, `addVat`, `stripVat`, `roundMoney` — single source of truth |
| `src/lib/vat-report.js` | สูตร ภ.พ.30, aggregation, compliance, CSV label |
| `src/lib/baht-text.js` | จำนวนเงินเป็นตัวอักษรไทย (ใบกำกับ A4) |
| `src/lib/tax-buyer.js` | `fullBuyerValid` — validation ผู้ซื้อใบเต็มรูป |
| `src/lib/ai-receive.js` | Net→Gross สำหรับ AI scan bill CMG |
| `src/main.jsx` | VatView, Receipt, FullTaxInvoiceA4, PurchaseDocA4, CreditNoteA4 |
| `supabase-migrations/027–030` | tax invoice, purchase doc, credit note |

## 1. การคำนวณ VAT 7%

ราคาขายเป็น **VAT-inclusive** (รวมภาษีแล้ว):

```
exVat = round(gross / 1.07)
vat   = gross - exVat
```

- **ขาย (POS):** client คำนวณ `vatBreakdown(grand)` ก่อนส่ง RPC
- **รับเข้า:** UI กรอกราคา **ก่อน VAT** → บันทึก **รวม VAT** (`× 1.07`)
- **ภ.พ.30 ฝั่งซื้อ:** ใช้ `7/107` จาก `total_value` เสมอ (แม้ `vat_rate=0` ใน header legacy)

## 2. ภาษีขาย (Output VAT)

### วงจรบิลขาย

1. `POSView` → `vatBreakdown(grand)` → RPC `create_sale_order_with_items` (v5)
2. Server ออก `tax_invoice_no` อัตโนมัติ (`next_tax_invoice_no`)
3. พิมพ์: ใบย่อ (default) / ใบเต็มรูป A4 / ใบเสร็จธรรมดา

### เลขใบกำกับภาษี

- รูปแบบ: `[prefix][YY พ.ศ.][รัน N หลัก]` เช่น `6900001`
- ตั้งค่า: `shop_settings.tax_invoice_prefix`, `tax_invoice_digits`
- ออกย้อนหลัง: `issue_tax_invoice_for_order` (admin)

### ประเภทเอกสาร

| ประเภท | มาตรา | เงื่อนไข |
|--------|-------|---------|
| ใบกำกับอย่างย่อ | ม.86/6 | ทุกบิลที่มีเลขใบกำกับ |
| ใบกำกับเต็มรูป | ม.86/4 | ชื่อ + Tax ID + ที่อยู่ผู้ซื้อครบ |
| Void | — | เก็บเลขใบกำกับ, CSV แสดงแถว "ยกเลิก" ค่า 0 |

## 3. ภาษีซื้อ (Input VAT)

### รับเข้า (Receive)

- `hasVat` toggle → บวก 7% อัตโนมัติตอน submit
- `supplier_tax_id`, `supplier_branch` denormalize จากทะเบียน `suppliers`
- `purchase_doc_no` ออกอัตโนมัติ (`RC6900001`)

### AI Scan CMG

- บิลแสดงราคาก่อน VAT → `addVat()` ก่อนบันทึก
- ทดสอบ: `tests/ai-receive.test.js`

## 4. ใบลดหนี้

| ประเภท | ตาราง | เลขรัน | ออกเลข |
|--------|-------|--------|--------|
| ขาย (รับคืนลูกค้า) | `return_orders` | `CN6900001` | Manual — กด "พิมพ์ใบลดหนี้" |
| ซื้อ (ส่งคืน supplier) | `supplier_claim_orders` | — | แสดงใน CSV เป็นแถวลบ |

CSV ภาษีขายใช้ `credit_note_no` จริงเมื่อออกแล้ว (มิฉะนั้น fallback `RT#id`)

## 5. รายงาน ภ.พ.30 (VatView)

### สูตร

```
ภาษีขายสุทธิ = Σ sale_orders (active) − return_orders
ภาษีซื้อสุทธิ = Σ receive_orders − supplier_claim_orders
VAT ที่ต้องจ่าย = ภาษีขายสุทธิ − ภาษีซื้อสุทธิ
```

### มุมมอง COGS (ภายใน)

```
ภาษีซื้อ COGS = cost_price × qty ที่ขาย × 7/107
กำไรหลัง VAT = (รายได้ − COGS) / 1.07
```

### Export CSV

1. `รายงานภาษีขาย_*.csv`
2. `รายงานภาษีซื้อ_*.csv`
3. `รายงานสินค้าและวัตถุดิบ_*.csv` (ม.87(3))

UTF-8 BOM + วันที่ พ.ศ.

### Compliance warnings

- บิลขายไม่มี `tax_invoice_no`
- บิลซื้อไม่มี `supplier_tax_id`
- บิลซื้อไม่มี `supplier_invoice_no`

## 6. RPC ภาษี

| RPC | สิทธิ์ |
|-----|-------|
| `create_sale_order_with_items` | authenticated |
| `issue_tax_invoice_for_order` | admin |
| `edit_sale_order` | admin |
| `create_stock_movement_with_items` | authenticated |
| `issue_purchase_doc_for_receive` | admin |
| `issue_credit_note_for_return` | admin |

## 7. การทดสอบอัตโนมัติ

```bash
npm test   # รวม tests/vat-report.test.js, tests/baht-text.test.js, tests/money.test.js
```

## 8. QA Production (อัปเดต มิ.ย. 2569)

| รายการ | ผล |
|--------|-----|
| `shop_tax_id` ตั้งค่าแล้ว | `0305569005495` |
| บิลขายมีเลขใบกำกับ | 97 (หลัง migration 027) |
| บิลขายไม่มีเลข (legacy) | 62,359 — ต้อง `issue_tax_invoice_for_order` ย้อนหลังถ้าต้องการยื่นครบ |
| บิล void ที่มีเลข | 4 |
| รับเข้าไม่มี supplier_tax_id | 2,921 |
| รับเข้าไม่มี supplier_invoice_no | 2,867 |
| return ที่มี credit_note_no | 0 (workflow manual ยังไม่ถูกใช้) |
| เลขรันใบกำกับ ปี 69 | last_seq = 101 |
| เลขรันเอกสารซื้อ ปี 69 | last_seq = 3 |

### Checklist ก่อนยื่น ภ.พ.30 รายเดือน

- [x] `shop_tax_id` กรอกครบ
- [ ] VatView → preset "เดือนที่แล้ว" → ตรวจ `vatPayable`
- [ ] Compliance panel = 0 issues ในช่วงที่ยื่น (หรือแก้บิลที่ขาดข้อมูล)
- [ ] Export CSV ภาษีขาย + ภาษีซื้อ
- [ ] บิล void ที่มีเลข → ปรากฏใน CSV เป็น "ยกเลิก"
- [ ] Return ที่ยื่นใบลดหนี้ → ออก `CN...` ก่อน export

## 9. จุดอ่อนที่ควรรู้

1. บิลเก่าก่อน 027 ไม่มีเลขใบกำกับ — compliance warning
2. ใบลดหนี้ไม่ auto-issue — admin ต้องกดพิมพ์เอง
3. `edit_sale_order` ไม่แก้ข้อมูลผู้ซื้อ/ภาษี
4. ภาษีซื้อ legacy อาจมี `vat_rate=0` แต่ VatView ยัง extract 7/107
