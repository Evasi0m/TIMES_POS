import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * AnimatedLogo — TICK mascot logo with 5 moods and 3 animation modes.
 *
 * Modes:
 *   "cycle"       → Login screen: rotates through all 5 moods every few seconds
 *                   with a crossfade + gentle floating animation.
 *   "interactive" → Sidebar / Mobile TopBar: shows default mood, wiggles on hover,
 *                   breathing glow at rest, click → random mood for 2s.
 *   "static"      → Just renders one mood with no animation.
 *
 * All 5 SVGs live in /logo/ (public folder) so they're served as-is by Vite.
 */

const MOODS = ['happy', 'love', 'wink', 'wow', 'sleep'];
const MOOD_SRCS = Object.fromEntries(
  MOODS.map(m => [m, `logo/TICK-${m}.svg`])
);

// Preload all mood images so crossfade doesn't flash white
function usePreloadImages() {
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    MOODS.forEach(m => {
      const img = new Image();
      img.src = MOOD_SRCS[m];
    });
  }, []);
}

export default function AnimatedLogo({
  size = 41,
  mode = 'static',
  className = '',
  defaultMood = 'happy',
}) {
  usePreloadImages();

  if (mode === 'cycle')       return <CycleLogo size={size} className={className} />;
  if (mode === 'interactive') return <InteractiveLogo size={size} className={className} defaultMood={defaultMood} />;
  return <StaticLogo size={size} className={className} mood={defaultMood} />;
}

/* ── Static: single mood, no animation ── */
function StaticLogo({ size, className, mood }) {
  return (
    <img
      src={MOOD_SRCS[mood] || MOOD_SRCS.happy}
      alt="TIMES logo"
      className={`animated-logo ${className}`}
      style={{ width: size, height: size, objectFit: 'contain' }}
      draggable={false}
    />
  );
}

/* ── Cycle: rotates moods with crossfade — used on Login ── */
function CycleLogo({ size, className }) {
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      // After fade-out completes, switch mood and fade back in
      setTimeout(() => {
        setIdx(prev => (prev + 1) % MOODS.length);
        setFading(false);
      }, 280); // matches CSS transition duration
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const mood = MOODS[idx];

  return (
    <div
      className={`animated-logo animated-logo--float ${className}`}
      style={{ width: size, height: size, position: 'relative' }}
    >
      <img
        key={mood}
        src={MOOD_SRCS[mood]}
        alt={`TIMES logo — ${mood}`}
        className={`animated-logo__img ${fading ? 'animated-logo__img--out' : 'animated-logo__img--in'}`}
        style={{ width: size, height: size, objectFit: 'contain' }}
        draggable={false}
      />
    </div>
  );
}

/* ── Interactive: hover wiggle, breathing glow, click → random mood ── */
function InteractiveLogo({ size, className, defaultMood }) {
  const [mood, setMood] = useState(defaultMood);
  const [bouncing, setBouncing] = useState(false);
  const timerRef = useRef(null);

  const handleClick = useCallback(() => {
    // Pick a random mood different from current
    const others = MOODS.filter(m => m !== mood);
    const pick = others[Math.floor(Math.random() * others.length)];
    setMood(pick);
    setBouncing(true);

    // Clear any existing timer
    if (timerRef.current) clearTimeout(timerRef.current);

    // Revert to default after 2s
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
    <img
      src={MOOD_SRCS[mood]}
      alt={`TIMES logo — ${mood}`}
      className={
        `animated-logo animated-logo--glow animated-logo--interactive` +
        (bouncing ? ' animated-logo--bounce' : '') +
        (className ? ` ${className}` : '')
      }
      style={{ width: size, height: size, objectFit: 'contain', cursor: 'pointer' }}
      onClick={handleClick}
      draggable={false}
      title="TICK — คลิกเปลี่ยน mood!"
    />
  );
}
