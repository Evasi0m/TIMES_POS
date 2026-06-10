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

export function msgLoadingCatalog() {
  return makeLogLine('$ กำลังโหลดรายชื่อสินค้าในระบบ...', 'dim');
}

export function msgCatalogLoaded(count) {
  return makeLogLine(`$ โหลดสินค้า ${fmtCount(count)} รายการแล้ว`);
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

export function msgWaitingSeconds(seconds) {
  return `$ รอ AI อ่านข้อความในบิล... ${seconds} วิ (ถ้า key แรกไม่ได้ จะลอง key ถัดไปให้เอง)`;
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
