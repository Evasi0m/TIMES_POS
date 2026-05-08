import { describe, it, expect, beforeEach, vi } from 'vitest';
import { subscribeTable, _resetRegistry } from '../src/lib/realtime-bus.js';

/**
 * Fake Supabase client that captures channel creation + event payloads so
 * we can assert multiplexing + cleanup behaviour without a live WS.
 */
function makeFakeSb() {
  const channels = [];
  return {
    channels,
    removed: [],
    channel(name) {
      const handlers = [];
      const ch = {
        name,
        _handlers: handlers,
        on(_evt, _filter, cb) {
          handlers.push(cb);
          return ch;
        },
        subscribe(statusCb) {
          ch._statusCb = statusCb;
          return ch;
        },
        // Test helper: fire a fake postgres_changes payload
        _fire(payload) {
          handlers.forEach((h) => h(payload));
        },
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      this.removed.push(ch.name);
    },
  };
}

describe('realtime-bus', () => {
  beforeEach(() => { _resetRegistry(); });

  it('opens exactly one channel per table even with multiple subscribers', () => {
    const sb = makeFakeSb();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const off1 = subscribeTable(sb, 'products', cb1);
    const off2 = subscribeTable(sb, 'products', cb2);

    expect(sb.channels.length).toBe(1);
    expect(sb.channels[0].name).toBe('rt:products');

    // Both callbacks receive the event
    sb.channels[0]._fire({ eventType: 'INSERT' });
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    off1();
    off2();
  });

  it('removes the channel only when the last subscriber unsubscribes', () => {
    const sb = makeFakeSb();
    const off1 = subscribeTable(sb, 'sale_orders', () => {});
    const off2 = subscribeTable(sb, 'sale_orders', () => {});

    off1();
    expect(sb.removed).toEqual([]);           // still has one listener

    off2();
    expect(sb.removed).toEqual(['rt:sale_orders']);
  });

  it('isolates failures in one listener from others', () => {
    const sb = makeFakeSb();
    const bad = () => { throw new Error('boom'); };
    const good = vi.fn();

    subscribeTable(sb, 'products', bad);
    subscribeTable(sb, 'products', good);

    // Suppress expected console.error from listener guard
    const origErr = console.error;
    console.error = () => {};
    try {
      sb.channels[0]._fire({ eventType: 'UPDATE' });
    } finally {
      console.error = origErr;
    }

    expect(good).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op unsubscribe when sb is missing', () => {
    const off = subscribeTable(null, 'products', () => {});
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });

  it('creates separate channels for different tables', () => {
    const sb = makeFakeSb();
    subscribeTable(sb, 'products', () => {});
    subscribeTable(sb, 'sale_orders', () => {});
    expect(sb.channels.map((c) => c.name).sort()).toEqual([
      'rt:products',
      'rt:sale_orders',
    ]);
  });
});
