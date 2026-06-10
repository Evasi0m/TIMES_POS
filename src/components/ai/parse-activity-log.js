/** Plain-Thai log message builders for CMG bill parsing. */

let _logSeq = 0;

export function nextLogId() {
  _logSeq += 1;
  return `plog-${Date.now()}-${_logSeq}`;
}

export function makeLogLine(text, tone = 'info') {
  return { id: nextLogId(), text, tone };
}

export function fmtCount(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('th-TH');
}

export function msgStartScan(count) {
  return makeLogLine(`$ เริ่มสแกนบิล ${count} ใบ`);
}

export function msgRetryScan(count) {
  return makeLogLine(`$ ลองอ่านใหม่เฉพาะบิลที่ยังไม่สำเร็จ (${count} ใบ)`, 'warn');
}

export function msgImagesReady(count) {
  return makeLogLine(`$ เตรียมรูปแล้ว — ${count} ไฟล์`);
}

export function msgPrepImages(count, totalKb) {
  const kb = Number(totalKb) || 0;
  const sizeLabel = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  return makeLogLine(`$ เตรียมรูป ${count} ไฟล์ · รวม ${sizeLabel}`);
}

export function msgLoadingCatalog() {
  return makeLogLine('$ กำลังโหลดรายชื่อสินค้าในระบบ...', 'dim');
}

export function msgCatalogStart() {
  return makeLogLine('$ ดึงรายชื่อสินค้าจากฐานข้อมูล...', 'dim');
}

export function msgCatalogLoaded(count) {
  return makeLogLine(`$ โหลดสินค้า ${fmtCount(count)} รายการแล้ว`);
}

export function msgCatalogDone(count, ms) {
  const secs = ((Number(ms) || 0) / 1000).toFixed(1);
  return makeLogLine(`$ โหลดสินค้า ${fmtCount(count)} รายการ · ใช้เวลา ${secs} วิ`);
}

export function msgCatalogWarn() {
  return makeLogLine('$ โหลดรายชื่อสินค้าไม่ครบ — จะลองอ่านบิลต่อไปก่อน', 'warn');
}

export function msgChunkHeader(chunkIndex, totalChunks) {
  return makeLogLine(`$ --- ชุดที่ ${chunkIndex}/${totalChunks} ---`, 'dim');
}

export function msgSendBills(from, to) {
  const label = from === to ? `บิล ${from}` : `บิล ${from}-${to}`;
  return makeLogLine(`$ ส่ง${label} ไปให้ AI อ่าน...`);
}

export function msgEdgeConnect(from, to) {
  const label = from === to ? `บิล ${from}` : `บิล ${from}-${to}`;
  return makeLogLine(`$ เชื่อมต่อ cmg-bill-parse · ส่ง${label}`);
}

export function msgWaitingSeconds(seconds) {
  return `$ รอ AI อ่านข้อความในบิล... ${seconds} วิ (ถ้า key แรกไม่ได้ จะลอง key ถัดไปให้เอง)`;
}

export function msgWaitingDetail(from, to, seconds) {
  const label = from === to ? `บิล ${from}` : `บิล ${from}-${to}`;
  return `$ รอ AI อ่าน ${label}... ${seconds} วิ · ระบบจะลอง API key ถัดไปอัตโนมัติหาก key แรกไม่พร้อม`;
}

export function msgResponseOk(billCount, ms) {
  const secs = ((Number(ms) || 0) / 1000).toFixed(1);
  return makeLogLine(`$ ได้ผลลัพธ์จาก AI · ${billCount} บิล · ${secs} วิ`, 'ok');
}

export function msgMatchSummary(billNo, auto, pick, none) {
  return makeLogLine(
    `$   จับคู่บิล ${billNo}: ตรง ${auto} · เลือก ${pick} · ไม่พบ ${none}`,
    'dim',
  );
}

export function msgDupCheckStart(n) {
  return makeLogLine(`$ ตรวจเลขบิลซ้ำ ${n} ใบ...`, 'dim');
}

export function msgTokenUsage(tokens, thb) {
  const tok = fmtCount(tokens);
  const cost = Number(thb) > 0 ? ` · ≈${Number(thb).toFixed(2)} บาท` : '';
  return makeLogLine(`$   token ${tok}${cost}`, 'dim');
}

export function msgBillSuccess(billNo, itemCount, invoiceNo) {
  const inv = invoiceNo ? ` · เลขที่ ${invoiceNo}` : '';
  return makeLogLine(`$ ✓ บิล ${billNo} อ่านได้ ${itemCount} รายการ${inv}`, 'ok');
}

export function msgChunkMeta(usage) {
  if (!usage) return null;
  const key = usage.key_label || usage.keyLabel || '';
  const model = usage.model || '';
  if (!key && !model) return null;
  const parts = [key, model].filter(Boolean).join(' · ');
  return makeLogLine(`$   ใช้ ${parts}`, 'dim');
}

export function msgAllDone(done, total) {
  return makeLogLine(`$ เสร็จแล้ว — อ่านครบ ${done}/${total} ใบ ไปหน้าตรวจสอบได้เลย`, 'ok');
}

export function msgParseError(title, hint) {
  const lines = [makeLogLine(`$ ✗ อ่านไม่สำเร็จ — ${title}`, 'warn')];
  if (hint) lines.push(makeLogLine(`$   ${hint}`, 'dim'));
  return lines;
}

/** Server-side trace lines (plain Thai, no secrets). */
export function msgTraceLines(trace) {
  if (!Array.isArray(trace) || !trace.length) return [];
  return trace.map((t) => makeLogLine(`$   ${t}`, 'dim'));
}

/** Step checklist for the parsing status panel (left side). */
export function deriveParsingSteps({ bills = [], progress, parseIsActive, logs = [] }) {
  const texts = logs.map((l) => l.text || '');
  const hasPrep = texts.some((t) => t.includes('เตรียมรูป'));
  const hasCatalogDone = texts.some(
    (t) => (t.includes('โหลดสินค้า') && t.includes('ใช้เวลา')) || t.includes('ไม่ครบ'),
  );
  const parsedCount = bills.filter((b) => b.parseState === 'parsed').length;
  const matchedCount = bills.filter((b) => (b.rows?.length ?? 0) > 0).length;
  const total = progress?.total ?? bills.length;
  const allParsed = total > 0 && parsedCount >= total;

  const defs = [
    { key: 'prep', label: 'เตรียมรูปภาพ', done: hasPrep },
    { key: 'catalog', label: 'โหลดรายชื่อสินค้า', done: hasCatalogDone },
    { key: 'ai', label: 'ส่งให้ AI อ่าน', done: allParsed },
    { key: 'match', label: 'จับคู่รุ่นในระบบ', done: allParsed && matchedCount >= total },
  ];

  let activeKey = null;
  if (!hasPrep) activeKey = 'prep';
  else if (!hasCatalogDone) activeKey = 'catalog';
  else if (!allParsed) activeKey = 'ai';
  else if (matchedCount < total) activeKey = 'match';

  return defs.map((d) => ({
    ...d,
    active: d.key === activeKey && !d.done,
    spinning: d.key === 'ai' && parseIsActive && !d.done,
  }));
}
