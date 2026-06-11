/** Payment method labels — shared between POS, sales table, receipts. */
export const PAYMENT_METHOD_LABELS = {
  cash: 'เงินสด',
  transfer: 'โอนเงิน',
  card: 'บัตร',
  paylater: 'paylater',
  cod: 'เก็บปลายทาง',
};

export function getPaymentMethodLabel(method) {
  if (!method) return '—';
  return PAYMENT_METHOD_LABELS[method] || method;
}
