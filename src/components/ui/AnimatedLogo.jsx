import React, { useState, useEffect, useCallback, useRef, useId, useMemo } from 'react';
import { tickSvg, MOODS } from './tickLogo.js';

/**
 * AnimatedLogo — TICK mascot logo with 5 moods and 3 animation modes.
 *
 * Modes:
 *   "cycle"       → Login screen: rotates through all 5 moods every few seconds
 *                   with a stable double-buffered spring crossfade and bobbing float.
 *   "interactive" → Sidebar / Mobile TopBar: shows default mood, wiggles on hover,
 *                   breathing glow at rest, click → random mood for 2s (with smooth morph back).
 *   "static"      → Just renders one mood with no animation.
 *
 * Art comes from tickLogo.js; public/logo/TICK-*.svg are exports of the same art.
 */

// Inline SVG layers (one per mood) — crisp at any size, no image requests.
function Layer({ mood, size, className, label }) {
  const uid = useId().replace(/:/g, '');
  const html = useMemo(() => tickSvg({ size, mood, id: `${uid}${mood}` }), [size, mood, uid]);
  return (
    <span
      className={className}
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function AnimatedLogo({
  size = 41,
  mode = 'static',
  className = '',
  defaultMood = 'happy',
}) {
  if (mode === 'cycle')       return <CycleLogo size={size} className={className} />;
  if (mode === 'interactive') return <InteractiveLogo size={size} className={className} defaultMood={defaultMood} />;
  return <StaticLogo size={size} className={className} mood={defaultMood} />;
}

/* ── Static: single mood, no animation ── */
function StaticLogo({ size, className, mood }) {
  return (
    <span className={`animated-logo animated-logo-container ${className}`} style={{ width: size, height: size }}>
      <Layer mood={MOODS.includes(mood) ? mood : 'happy'} size={size} className="animated-logo-layer" label="TIMES logo" />
    </span>
  );
}

/* ── Cycle: rotates moods with stable-rendered spring crossfade ── */
function CycleLogo({ size, className }) {
  const [idx, setIdx] = useState(0);
  const [prevIdx, setPrevIdx] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setPrevIdx(idx);
      setIdx(prev => (prev + 1) % MOODS.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [idx]);

  const currentMood = MOODS[idx];
  const previousMood = prevIdx !== null ? MOODS[prevIdx] : null;

  return (
    <div
      className={`animated-logo animated-logo-container animated-logo--float ${className}`}
      style={{ width: size, height: size }}
    >
      {MOODS.map(m => {
        const isCurrent = m === currentMood;
        const isPrevious = m === previousMood;
        
        let layerClass = "animated-logo-layer animated-logo-layer--hidden";
        if (isCurrent) {
          layerClass = "animated-logo-layer animated-logo-layer--incoming";
        } else if (isPrevious) {
          layerClass = "animated-logo-layer animated-logo-layer--outgoing";
        }

        return (
          <Layer key={m} mood={m} size={size} className={layerClass} label={`TIMES logo — ${m}`} />
        );
      })}
    </div>
  );
}

/* ── Interactive: hover wiggle, breathing glow, click → random mood with smooth morph ── */
function InteractiveLogo({ size, className, defaultMood }) {
  const [mood, setMood] = useState(defaultMood);
  const [prevMood, setPrevMood] = useState(null);
  const [bouncing, setBouncing] = useState(false);
  const timerRef = useRef(null);

  const handleClick = useCallback(() => {
    // Pick a random mood different from current
    const others = MOODS.filter(m => m !== mood);
    const pick = others[Math.floor(Math.random() * others.length)];
    
    setPrevMood(mood);
    setMood(pick);
    setBouncing(true);

    // Clear any existing timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Revert to default after 2s with smooth morph
    timerRef.current = setTimeout(() => {
      setPrevMood(pick);
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
      {MOODS.map(m => {
        const isCurrent = m === mood;
        const isPrevious = m === prevMood;
        
        let layerClass = "animated-logo-layer animated-logo-layer--hidden";
        if (isCurrent) {
          layerClass = "animated-logo-layer animated-logo-layer--incoming";
        } else if (isPrevious) {
          layerClass = "animated-logo-layer animated-logo-layer--outgoing";
        }

        return (
          <Layer key={m} mood={m} size={size} className={layerClass} label={`TIMES logo — ${m}`} />
        );
      })}
    </div>
  );
}
