import React, { useEffect, useState, useCallback } from 'react';
import Icon from './Icon.jsx';
import UpdateLogModal from './UpdateLogModal.jsx';
import { onUpdateLogChange, refreshUpdateLogState } from '../../lib/update-log.js';

export default function UpdateLogButton({ className = 'btn-patch-log-sidebar', onDone }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    refreshUpdateLogState().catch(() => {});
    return onUpdateLogChange(({ unread: u }) => setUnread(u));
  }, []);

  const closeModal = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 240);
  }, [closing]);

  const handleOpen = () => {
    setOpen(true);
    onDone?.();
  };

  return (
    <>
      <button
        type="button"
        className={className + ' relative'}
        onClick={handleOpen}
        title="ดูบันทึกอัปเดตที่ผ่านมา"
      >
        <Icon name="file" size={16}/>
        รายการอัปเดต
        {unread && (
          <span className="ul-sidebar-badge" aria-label="มีอัปเดตใหม่"/>
        )}
      </button>
      {open && (
        <UpdateLogModal open={open} closing={closing} onClose={closeModal}/>
      )}
    </>
  );
}
