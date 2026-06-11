import { orderStatusBadgeStyle } from './order-status-badge-style.js';

/** @deprecated Use orderStatusBadgeStyle({ tone: 'purple', shape: 'pill' }) */
export function substitutionBadgeStyle({ compact = true } = {}) {
  return orderStatusBadgeStyle({ tone: 'purple', compact, shape: 'pill' });
}
