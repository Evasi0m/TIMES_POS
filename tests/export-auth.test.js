import { describe, it, expect, vi, beforeEach } from 'vitest';

const invokeMock = vi.fn();

vi.mock('../src/lib/supabase-client.js', () => ({
  sb: {
    functions: {
      invoke: (...args) => invokeMock(...args),
    },
  },
}));

import {
  verifyCurrentUserPassword,
  exporterDisplayName,
  PRODUCTS_EXPORT_PENDING_KEY,
} from '../src/lib/export-auth.js';

describe('verifyCurrentUserPassword', () => {
  beforeEach(() => invokeMock.mockReset());

  it('calls verify-export-password edge function on success', async () => {
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
    const res = await verifyCurrentUserPassword('secret', 'User@Times.com');
    expect(res).toEqual({ ok: true });
    expect(invokeMock).toHaveBeenCalledWith('verify-export-password', {
      body: { password: 'secret' },
    });
  });

  it('returns mapped error on invalid password', async () => {
    invokeMock.mockResolvedValue({
      data: { ok: false, error: 'invalid_password', message: 'Invalid login credentials' },
      error: null,
    });
    const res = await verifyCurrentUserPassword('bad', 'user@times.com');
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it('returns mapped error when invoke fails', async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'FunctionsRelayError' },
    });
    const res = await verifyCurrentUserPassword('bad', 'user@times.com');
    expect(res.ok).toBe(false);
    expect(res.message).toBeTruthy();
  });

  it('rejects empty password without calling edge function', async () => {
    const res = await verifyCurrentUserPassword('', 'user@times.com');
    expect(res).toEqual({ ok: false, message: 'กรุณากรอกรหัสผ่าน' });
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe('exporterDisplayName', () => {
  it('prefers user_metadata.full_name', () => {
    expect(exporterDisplayName({ email: 'a@b.com', user_metadata: { full_name: 'Somchai' } })).toBe('Somchai');
  });

  it('falls back to email local-part', () => {
    expect(exporterDisplayName({ email: 'somchai@times.com' })).toBe('somchai');
  });
});

describe('PRODUCTS_EXPORT_PENDING_KEY', () => {
  it('is a stable sessionStorage key', () => {
    expect(PRODUCTS_EXPORT_PENDING_KEY).toBe('products_export_pending');
  });
});
