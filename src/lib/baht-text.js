// Convert a baht amount to Thai words for full tax invoices (ม.86/4).
import { roundMoney } from './money.js';

const TH_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const TH_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

function readInt(s) {
  s = String(s).replace(/^0+/, '') || '0';
  if (s === '0') return TH_DIGITS[0];
  if (s.length > 7) {
    const head = s.slice(0, s.length - 6);
    const tail = s.slice(s.length - 6);
    return readInt(head) + 'ล้าน' + (Number(tail) ? readInt(tail) : '');
  }
  let out = '';
  const len = s.length;
  for (let i = 0; i < len; i++) {
    const d = Number(s[i]);
    const place = len - i - 1;
    if (d === 0) continue;
    if (place === 1 && d === 1) out += 'สิบ';
    else if (place === 1 && d === 2) out += 'ยี่สิบ';
    else if (place === 0 && d === 1 && len > 1) out += 'เอ็ด';
    else out += TH_DIGITS[d] + TH_PLACES[place];
  }
  return out;
}

/** e.g. 1070 → "หนึ่งพันเจ็ดสิบบาทถ้วน" */
export function bahtText(amount) {
  const num = roundMoney(Math.abs(Number(amount) || 0));
  const baht = Math.floor(num);
  const satang = Math.round((num - baht) * 100);
  let txt = readInt(baht) + 'บาท';
  txt += satang ? readInt(satang) + 'สตางค์' : 'ถ้วน';
  return txt;
}
