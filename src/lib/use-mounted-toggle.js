import { useEffect, useState } from 'react';

/** Keep mounted briefly after `open` flips false so exit animation can run. */
export function useMountedToggle(open, exitMs = 220) {
  const [render, setRender] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) { setRender(true); setClosing(false); }
    else if (render) {
      setClosing(true);
      const t = setTimeout(() => { setRender(false); setClosing(false); }, exitMs);
      return () => clearTimeout(t);
    }
  }, [open, render]);
  return { render, closing };
}
