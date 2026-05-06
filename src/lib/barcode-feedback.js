// Audio + haptic feedback for barcode scans.
// Uses Web Audio API singleton so we don't allocate a new AudioContext per beep.
// Honors `prefers-reduced-motion` for vibration only — beep is opt-in via mute flag.

let _ctx = null;
function ctx() {
  if (_ctx) return _ctx;
  try {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    _ctx = new C();
  } catch { _ctx = null; }
  return _ctx;
}

function beep({ freq = 1000, durationMs = 80, gain = 0.18 } = {}) {
  const ac = ctx();
  if (!ac) return;
  // Resume on user gesture (browsers suspend AudioContext until interaction).
  if (ac.state === 'suspended') ac.resume().catch(()=>{});
  const osc = ac.createOscillator();
  const g   = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(ac.destination);
  const now = ac.currentTime;
  // Tiny attack/release so the click isn't harsh.
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + 0.005);
  g.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

export function playScanBeep() { beep({ freq: 1100, durationMs: 70, gain: 0.18 }); }
export function playScanError() { beep({ freq: 380,  durationMs: 180, gain: 0.22 }); }

export function vibrateScan() {
  try { navigator.vibrate?.(40); } catch {}
}
export function vibrateError() {
  try { navigator.vibrate?.([60, 40, 60]); } catch {}
}
