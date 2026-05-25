// Mobile-first camera barcode scanner.
//
// Strategy:
//   1) Use Web `BarcodeDetector` API natively when available (Chrome/Edge,
//      Safari iOS 16.4+, modern Android WebView). Zero bundle cost.
//   2) Fall back to `@zxing/browser` (lazy-loaded) for Firefox / older iOS.
//
// Hook returns control + state for a `<video>` element the consumer renders.
// We don't render any UI here — the modal does that.
//
// Lifecycle: enabled flag turns the camera on/off; cleanup stops MediaStream
// tracks (so the device LED actually goes dark) and any zxing reader.

import { useEffect, useRef, useState, useCallback } from 'react';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

// Cache support detection across hook instances.
let _supportPromise = null;
export function detectBarcodeSupport() {
  if (_supportPromise) return _supportPromise;
  _supportPromise = (async () => {
    if (typeof window === 'undefined') return 'none';
    if (!navigator.mediaDevices?.getUserMedia) return 'none';
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (supported && supported.length) return 'native';
      } catch {}
    }
    return 'zxing';
  })();
  return _supportPromise;
}

// Lazy-loaded zxing reader (~50 KB gz).
let _zxingPromise = null;
function loadZxing() {
  if (_zxingPromise) return _zxingPromise;
  _zxingPromise = import('@zxing/browser').then(m => m.BrowserMultiFormatReader);
  return _zxingPromise;
}

const FACING_KEY = 'pos.scanner.facing';
export function getPreferredFacing() {
  try { return localStorage.getItem(FACING_KEY) || 'environment'; } catch { return 'environment'; }
}
export function setPreferredFacing(v) {
  try { localStorage.setItem(FACING_KEY, v); } catch {}
}

/**
 * @param {Object} opts
 * @param {React.RefObject<HTMLVideoElement>} opts.videoRef
 * @param {boolean} opts.enabled  — when false, stream is stopped
 * @param {(code:string)=>void} opts.onDetect  — fires per accepted code
 * @param {number} [opts.debounceMs=1500] — same code within this window is ignored
 * @param {'environment'|'user'} [opts.facing='environment']
 */
export function useBarcodeScanner({ videoRef, enabled, onDetect, debounceMs = 1500, facing = 'environment' }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'starting' | 'running' | 'denied' | 'unsupported' | 'error'
  const [supportMode, setSupportMode] = useState(null); // 'native' | 'zxing'
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const streamRef = useRef(null);
  const trackRef  = useRef(null);
  const detectorRef = useRef(null);  // native BarcodeDetector
  const readerRef = useRef(null);    // zxing reader
  const rafRef = useRef(0);
  const stoppedRef = useRef(false);
  const lastHitRef = useRef({ code: '', at: 0 });
  const onDetectRef = useRef(onDetect);
  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  const handleHit = useCallback((rawValue) => {
    if (!rawValue) return;
    const code = String(rawValue).trim();
    if (!code) return;
    const now = Date.now();
    const last = lastHitRef.current;
    if (last.code === code && now - last.at < debounceMs) return;
    lastHitRef.current = { code, at: now };
    onDetectRef.current?.(code);
  }, [debounceMs]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    try { readerRef.current?.reset?.(); } catch {}
    readerRef.current = null;
    detectorRef.current = null;
    const s = streamRef.current;
    if (s) {
      try { s.getTracks().forEach(t => t.stop()); } catch {}
    }
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) {
      try { videoRef.current.srcObject = null; } catch {}
    }
    setTorchOn(false);
    setTorchSupported(false);
  }, [videoRef]);

  // Main start/stop effect.
  useEffect(() => {
    if (!enabled) { stop(); setStatus('idle'); return; }
    let cancelled = false;
    stoppedRef.current = false;
    setStatus('starting');

    (async () => {
      const mode = await detectBarcodeSupport();
      if (cancelled) return;
      if (mode === 'none') { setStatus('unsupported'); return; }
      setSupportMode(mode);

      // Request camera with the preferred facing. `ideal` so devices that
      // only have one camera don't fail the constraint outright.
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (e) {
        if (cancelled) return;
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') setStatus('denied');
        else setStatus('error');
        return;
      }
      if (cancelled || stoppedRef.current) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        return;
      }

      streamRef.current = stream;
      trackRef.current  = stream.getVideoTracks()[0] || null;

      // Probe torch capability (Chrome/Android exposes it; iOS does not).
      try {
        const caps = trackRef.current?.getCapabilities?.();
        if (caps && 'torch' in caps) setTorchSupported(true);
      } catch {}

      const v = videoRef.current;
      if (!v) { stop(); return; }
      v.srcObject = stream;
      v.setAttribute('playsinline', 'true');
      v.muted = true;
      try { await v.play(); } catch {}

      if (cancelled || stoppedRef.current) return;
      setStatus('running');

      if (mode === 'native') {
        try {
          detectorRef.current = new window.BarcodeDetector({ formats: FORMATS });
        } catch {
          // Some Safari versions throw on unsupported formats — retry without filter.
          detectorRef.current = new window.BarcodeDetector();
        }
        const tick = async () => {
          if (stoppedRef.current || !detectorRef.current) return;
          const vid = videoRef.current;
          if (vid && vid.readyState >= 2) {
            try {
              const codes = await detectorRef.current.detect(vid);
              if (codes && codes.length) handleHit(codes[0].rawValue);
            } catch {}
          }
          // ~6 fps — good balance between battery and responsiveness.
          rafRef.current = window.setTimeout(tick, 160);
        };
        tick();
      } else {
        // zxing path
        try {
          const Reader = await loadZxing();
          if (cancelled || stoppedRef.current) return;
          const reader = new Reader();
          readerRef.current = reader;
          // Reader pulls frames from the existing srcObject's video element.
          reader.decodeFromVideoElement(v, (result, err) => {
            if (stoppedRef.current) return;
            if (result) handleHit(result.getText());
          });
        } catch (e) {
          if (cancelled) return;
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      // setTimeout id stored in rafRef; reuse cancel for both safety
      try { clearTimeout(rafRef.current); } catch {}
      stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, facing, stop, handleHit]);

  const toggleTorch = useCallback(async () => {
    const t = trackRef.current;
    if (!t || !torchSupported) return;
    const next = !torchOn;
    try {
      await t.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {}
  }, [torchOn, torchSupported]);

  return { status, supportMode, torchSupported, torchOn, toggleTorch };
}
