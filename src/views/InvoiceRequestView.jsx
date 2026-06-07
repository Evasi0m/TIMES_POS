// Public TikTok invoice request form — no login required.
import React, { useState } from 'react';
import { fullBuyerValid } from '../lib/tax-buyer.js';
import { SUPABASE_URL } from '../lib/supabase-client.js';
import Icon from '../components/ui/Icon.jsx';

export default function InvoiceRequestView({ token }) {
  const [buyer, setBuyer] = useState({
    name: '',
    taxId: '',
    address: '',
    branch: 'สำนักงานใหญ่',
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!fullBuyerValid(buyer)) {
      setError('กรุณากรอก ชื่อผู้ซื้อ เลขประจำตัวผู้เสียภาษี (10-13 หลัก) และที่อยู่ให้ครบ');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/tiktok-invoice-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          buyer_name: buyer.name.trim(),
          buyer_tax_id: buyer.taxId.trim(),
          buyer_address: buyer.address.trim(),
          buyer_branch: buyer.branch.trim() || 'สำนักงานใหญ่',
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'ส่งไม่สำเร็จ');
      setDone(true);
    } catch (err) {
      setError(err?.message || 'ส่งไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-surface">
        <div className="card-canvas p-6 max-w-md text-center">
          <Icon name="alert" size={32} className="text-error mx-auto mb-3"/>
          <h1 className="font-display text-xl mb-2">ลิงก์ไม่ถูกต้อง</h1>
          <p className="text-muted text-sm">กรุณาติดต่อร้านเพื่อขอลิงก์ใหม่</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-surface">
        <div className="card-canvas p-6 max-w-md text-center">
          <Icon name="check" size={32} className="text-success mx-auto mb-3"/>
          <h1 className="font-display text-xl mb-2">ได้รับข้อมูลแล้ว</h1>
          <p className="text-muted text-sm">ร้านจะออกใบกำกับภาษีและจัดส่งให้ตามช่องทางที่ตกลงกัน</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-surface">
      <form className="card-canvas p-6 max-w-lg w-full space-y-4" onSubmit={submit}>
        <div className="text-center mb-2">
          <h1 className="font-display text-xl">ขอใบกำกับภาษี</h1>
          <p className="text-sm text-muted mt-1">กรอกข้อมูลผู้ซื้อสำหรับใบกำกับภาษีเต็มรูป</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">ชื่อผู้ซื้อ / นิติบุคคล *</label>
          <input className="input w-full" value={buyer.name} onChange={e => setBuyer(b => ({ ...b, name: e.target.value }))} required/>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">เลขประจำตัวผู้เสียภาษี *</label>
          <input className="input w-full font-mono" value={buyer.taxId} onChange={e => setBuyer(b => ({ ...b, taxId: e.target.value }))} placeholder="13 หลัก" required/>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">ที่อยู่ *</label>
          <textarea className="input w-full" rows={3} value={buyer.address} onChange={e => setBuyer(b => ({ ...b, address: e.target.value }))} required/>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-soft block mb-1">สาขา</label>
          <input className="input w-full" value={buyer.branch} onChange={e => setBuyer(b => ({ ...b, branch: e.target.value }))}/>
        </div>

        {error && <div className="text-sm text-error bg-error/10 rounded-lg px-3 py-2">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <span className="spinner"/> : <Icon name="check" size={16}/>}
          ส่งข้อมูล
        </button>
      </form>
    </div>
  );
}
