import React, { useState, useEffect, useCallback, useRef, useId, useMemo } from 'react';
import { tickSvg, MOODS, THEMES } from './tickLogo.js';

/**
 * AnimatedLogo — TICK mascot logo with 5 moods and 3 animation modes.
 *
 * Modes:
 *   "cycle"       → Login screen: rotates through all 5 moods every few seconds
 *                   (colours rotate too while theme="auto", the default)
 *                   with a stable double-buffered spring crossfade and bobbing float.
 *   "interactive" → Sidebar / Mobile TopBar: shows default mood, wiggles on hover,
 *                   breathing glow at rest, click → random mood for 2s (with smooth morph back).
 *   "static"      → Just renders one mood with no animation.
 *
 * Art comes from tickLogo.js; public/logo/TICK-*.svg are exports of the same art.
 */

// Inline SVG layers (one per mood) — crisp at any size, no image requests.
function Layer({ mood, size, theme, className, label }) {
  const uid = useId().replace(/:/g, '');
  const html = useMemo(() => tickSvg({ size, mood, theme, id: `${uid}${mood}` }), [size, mood, theme, uid]);
  return (
    <span
      className={className}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Theme rotation for animated modes: orange → white → black → …
const THEME_MS = 5000;
function useTheme(theme) {
  const auto = theme === 'auto';
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(() => setI(n => (n + 1) % THEMES.length), THEME_MS);
    return () => clearInterval(t);
  }, [auto]);
  return auto ? THEMES[i] : theme;
}

// Every theme × mood stays mounted so a change of either crossfades.
function Layers({ size, theme, mood, prev }) {
  return THEMES.flatMap(t => MOODS.map(m => {
    const key = `${t}:${m}`;
    const state = key === `${theme}:${mood}` ? 'incoming' : key === prev ? 'outgoing' : 'hidden';
    return (
      <Layer key={key} theme={t} mood={m} size={size}
        className={`animated-logo-layer animated-logo-layer--${state}`} label={`TIMES logo — ${m}`} />
    );
  }));
}

// Remembers the previously shown theme:mood so it can play the outgoing state.
function usePrevKey(key) {
  const [state, setState] = useState({ cur: key, prev: null });
  if (state.cur !== key) setState({ cur: key, prev: state.cur });
  return state.prev;
}

export default function AnimatedLogo({
  size = 41,
  mode = 'static',
  className = '',
  defaultMood = 'happy',
  /** 'orange' | 'white' | 'black', or 'auto' to rotate (animated modes) */
  theme = 'auto',
}) {
  if (mode === 'cycle')       return <CycleLogo size={size} theme={theme} className={className} />;
  if (mode === 'interactive') return <InteractiveLogo size={size} theme={theme} className={className} defaultMood={defaultMood} />;
  return <StaticLogo size={size} theme={theme === 'auto' ? 'orange' : theme} className={className} mood={defaultMood} />;
}

/* ── Static: single mood, no animation ── */
function StaticLogo({ size, theme, className, mood }) {
  return (
    <span className={`animated-logo animated-logo-container ${className}`} style={{ width: size, height: size }}>
      <Layer theme={theme} mood={MOODS.includes(mood) ? mood : 'happy'} size={size} className="animated-logo-layer" label="TIMES logo" />
    </span>
  );
}

/* ── Cycle: rotates moods (and colours when theme="auto") with spring crossfade ── */
function CycleLogo({ size, theme, className }) {
  const [idx, setIdx] = useState(0);
  const shownTheme = useTheme(theme);

  useEffect(() => {
    const interval = setInterval(() => setIdx(prev => (prev + 1) % MOODS.length), 3000);
    return () => clearInterval(interval);
  }, []);

  const mood = MOODS[idx];
  const prev = usePrevKey(`${shownTheme}:${mood}`);

  return (
    <div
      className={`animated-logo animated-logo-container animated-logo--float ${className}`}
      style={{ width: size, height: size }}
    >
      <Layers size={size} theme={shownTheme} mood={mood} prev={prev} />
    </div>
  );
}

/* ── Interactive: hover wiggle, breathing glow, colours rotate, click → random mood ── */
function InteractiveLogo({ size, theme, className, defaultMood }) {
  const [mood, setMood] = useState(defaultMood);
  const [bouncing, setBouncing] = useState(false);
  const timerRef = useRef(null);
  const shownTheme = useTheme(theme);
  const prev = usePrevKey(`${shownTheme}:${mood}`);

  const handleClick = useCallback(() => {
    // Pick a random mood different from current
    const others = MOODS.filter(m => m !== mood);
    const pick = others[Math.floor(Math.random() * others.length)];

    setMood(pick);
    setBouncing(true);

    // Clear any existing timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Revert to default after 2s with smooth morph
    timerRef.current = setTimeout(() => {
      setMood(defaultMood);
      setBouncing(false);
    }, 2000);
  }, [mood, defaultMood]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div
      className={
        `animated-logo animated-logo-container animated-logo--glow animated-logo--interactive` +
        (bouncing ? ' animated-logo--bounce' : '') +
        (className ? ` ${className}` : '')
      }
      style={{ width: size, height: size, cursor: 'pointer' }}
      onClick={handleClick}
      title="TICK — คลิกเปลี่ยน mood!"
    >
      <Layers size={size} theme={shownTheme} mood={mood} prev={prev} />
    </div>
  );
}
