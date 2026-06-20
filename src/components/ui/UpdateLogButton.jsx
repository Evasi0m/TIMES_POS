import React, { useEffect, useState, useCallback } from 'react';
import Icon from './Icon.jsx';
import UpdateLogModal from './UpdateLogModal.jsx';
import { onUpdateLogChange, refreshUpdateLogState } from '../../lib/update-log.js';

/**
 * @param {object} props
 * @param {string} [props.className]
 * @param {() => void} [props.onDone] — e.g. close mobile drawer after open
 * @param {boolean} [props.controlled] — parent renders UpdateLogModal (survives drawer unmount)
 * @param {() => void} [props.onOpenRequest] — required when controlled
 */
export default function UpdateLogButton({
  className = 'btn-patch-log-sidebar',
  onDone,
  controlled = false,
  onOpenRequest,
}) {
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
    if (controlled) {
      onOpenRequest?.();
    } else {
      setOpen(true);
    }
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
      {!controlled && open && (
        <UpdateLogModal open={open} closing={closing} onClose={closeModal}/>
      )}
    </>
  );
}
