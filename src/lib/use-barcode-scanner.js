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
import {
  RETAIL_BARCODE_FORMATS,
  buildCameraConstraints,
  cropVideoToReticleCanvas,
  intersectFormats,
  nativeScanIntervalMs,
  isIOSDevice,
} from './barcode-scan-helpers.js';

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

// Lazy-loaded zxing reader (~50 KB gz) with retail-only format hints.
let _zxingPromise = null;
function loadZxingReader() {
  if (_zxingPromise) return _zxingPromise;
  _zxingPromise = (async () => {
    const [{ BrowserMultiFormatReader }, lib] = await Promise.all([
      import('@zxing/browser'),
      import('@zxing/library'),
    ]);
    const hints = new Map();
    hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
      lib.BarcodeFormat.EAN_13,
      lib.BarcodeFormat.EAN_8,
      lib.BarcodeFormat.UPC_A,
      lib.BarcodeFormat.UPC_E,
      lib.BarcodeFormat.CODE_128,
    ]);
    hints.set(lib.DecodeHintType.TRY_HARDER, true);
    const ios = isIOSDevice();
    return new BrowserMultiFormatReader(hints, {
      delayBetweenScanAttempts: ios ? 90 : 70,
      delayBetweenScanSuccess: 600,
    });
  })();
  return _zxingPromise;
}

const FACING_KEY = 'pos.scanner.facing';
export function getPreferredFacing() {
  try { return localStorage.getItem(FACING_KEY) || 'environment'; } catch { return 'environment'; }
}
export function setPreferredFacing(v) {
  try { localStorage.setItem(FACING_KEY, v); } catch {}
}

function clearScanTimer(id) {
  if (!id) return;
  try { clearTimeout(id); } catch {}
  try { cancelAnimationFrame(id); } catch {}
}

/**
 * @param {Object} opts
 * @param {React.RefObject<HTMLVideoElement>} opts.videoRef
 * @param {boolean} opts.enabled  — when false, stream is stopped
 * @param {(code:string)=>void} opts.onDetect  — fires per accepted code
 * @param {number} [opts.debounceMs=700] — same code within this window is ignored
 * @param {'environment'|'user'} [opts.facing='environment']
 */
export function useBarcodeScanner({ videoRef, enabled, onDetect, debounceMs = 700, facing = 'environment' }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'starting' | 'running' | 'denied' | 'unsupported' | 'error'
  const [supportMode, setSupportMode] = useState(null); // 'native' | 'zxing'
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const streamRef = useRef(null);
  const trackRef  = useRef(null);
  const detectorRef = useRef(null);  // native BarcodeDetector
  const readerRef = useRef(null);    // zxing reader
  const cropCanvasRef = useRef(null);
  const scanTimerRef = useRef(0);
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
    clearScanTimer(scanTimerRef.current);
    scanTimerRef.current = 0;
    try { readerRef.current?.reset?.(); } catch {}
    readerRef.current = null;
    detectorRef.current = null;
    cropCanvasRef.current = null;
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

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildCameraConstraints(facing),
          audio: false,
        });
      } catch (e) {
        // iOS / older browsers may reject focusMode — retry without it.
        try {
          const { focusMode, ...video } = buildCameraConstraints(facing);
          stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        } catch (e2) {
          if (cancelled) return;
          const err = e2 || e;
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') setStatus('denied');
          else setStatus('error');
          return;
        }
      }
      if (cancelled || stoppedRef.current) {
        try { stream.getTracks().forEach(t => t.stop()); } catch {}
        return;
      }

      streamRef.current = stream;
      trackRef.current  = stream.getVideoTracks()[0] || null;

      try {
        const caps = trackRef.current?.getCapabilities?.();
        if (caps && 'torch' in caps) setTorchSupported(true);
      } catch {}

      const v = videoRef.current;
      if (!v) { stop(); return; }
      v.srcObject = stream;
      v.setAttribute('playsinline', 'true');
      v.setAttribute('webkit-playsinline', 'true');
      v.muted = true;
      try { await v.play(); } catch {}

      if (cancelled || stoppedRef.current) return;
      setStatus('running');

      if (mode === 'native') {
        let formats = RETAIL_BARCODE_FORMATS;
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          formats = intersectFormats(RETAIL_BARCODE_FORMATS, supported);
        } catch {}
        try {
          detectorRef.current = new window.BarcodeDetector({ formats });
        } catch {
          detectorRef.current = new window.BarcodeDetector();
        }

        if (!cropCanvasRef.current && typeof document !== 'undefined') {
          cropCanvasRef.current = document.createElement('canvas');
        }

        const interval = nativeScanIntervalMs();
        let lastScanAt = 0;
        let inFlight = false;

        const tick = (now) => {
          if (stoppedRef.current || !detectorRef.current) return;
          scanTimerRef.current = requestAnimationFrame(tick);
          const ts = typeof now === 'number' ? now : performance.now();
          if (inFlight || ts - lastScanAt < interval) return;

          const vid = videoRef.current;
          if (!vid || vid.readyState < 2) return;

          lastScanAt = ts;
          inFlight = true;
          (async () => {
            try {
              const canvas = cropCanvasRef.current;
              const source = canvas
                ? (cropVideoToReticleCanvas(vid, canvas) || vid)
                : vid;
              const codes = await detectorRef.current.detect(source);
              if (codes?.length) handleHit(codes[0].rawValue);
            } catch {
              // ignore frame errors
            } finally {
              inFlight = false;
            }
          })();
        };
        scanTimerRef.current = requestAnimationFrame(tick);
      } else {
        try {
          const reader = await loadZxingReader();
          if (cancelled || stoppedRef.current) return;
          readerRef.current = reader;
          reader.decodeFromVideoElement(v, (result) => {
            if (stoppedRef.current) return;
            if (result) handleHit(result.getText());
          });
        } catch {
          if (cancelled) return;
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      clearScanTimer(scanTimerRef.current);
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
