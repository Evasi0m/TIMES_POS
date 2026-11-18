import { describe, it, expect } from 'vitest';
import { ECOMMERCE_CHANNELS } from '../src/lib/ecommerce-channels.js';
import { movementDecision } from '../src/lib/bigseller-export.js';
import { CHANNEL_LABELS, channelLabelForOrder, channelBadgeStyle } from '../src/lib/channel-badge-meta.js';

describe('Thaimart channel', () => {
  it('is a marketplace channel (net_received applies)', () => {
    expect(ECOMMERCE_CHANNELS.has('thaimart')).toBe(true);
  });
  it('sales are exported to BigSeller like every channel', () => {
    expect(movementDecision({ reason: 'sale', channel: 'thaimart' })).toBe('export');
  });
  it('has a label and its own badge style', () => {
    expect(CHANNEL_LABELS.thaimart).toBe('Thaimart');
    expect(channelLabelForOrder({ channel: 'thaimart' })).toBe('Thaimart');
    expect(channelBadgeStyle('thaimart').color).not.toBe(channelBadgeStyle('store').color);
  });
});
