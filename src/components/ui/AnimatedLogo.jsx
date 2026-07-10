import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMouseFollowTilt } from '../../hooks/useMouseFollowTilt.js';
import { useEyeTracking } from '../../hooks/useEyeTracking.js';
import TickLogoSvg from './TickLogoSvg.jsx';
import { TICK_EYE_CONFIG, TRACKABLE_MOODS } from './tickLogoEyeConfig.js';

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
 * All 5 SVGs live in /logo/ (public folder) so they're served as-is by Vite.
 */

const MOODS = ['happy', 'love', 'wink', 'wow', 'sleep'];
const TRACKABLE = new Set(TRACKABLE_MOODS);
const ZERO_OFFSETS = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
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
          <img
            key={m}
            src={MOOD_SRCS[m]}
            alt={`TIMES logo — ${m}`}
            className={layerClass}
            draggable={false}
          />
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
  const trackRef = useRef(null);
  const svgRef = useRef(null);

  const eyeConfig = TICK_EYE_CONFIG[mood];
  const eyes = eyeConfig?.tracking === 'none' ? [] : (eyeConfig?.eyes ?? []);
  const { rotateX, rotateY } = useMouseFollowTilt(trackRef);
  const { offsets } = useEyeTracking(trackRef, svgRef, eyes);

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

  const tiltStyle = useMemo(
    () => ({ transform: `perspective(400px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)` }),
    [rotateX, rotateY],
  );

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
      <div
        ref={trackRef}
        className="animated-logo-tilt"
        style={tiltStyle}
      >
        {MOODS.map(m => {
          const isCurrent = m === mood;
          const isPrevious = m === prevMood;

          let layerClass = 'animated-logo-layer animated-logo-layer--hidden';
          if (isCurrent) {
            layerClass = 'animated-logo-layer animated-logo-layer--incoming';
          } else if (isPrevious) {
            layerClass = 'animated-logo-layer animated-logo-layer--outgoing';
          }

          if (TRACKABLE.has(m)) {
            const pupilOffsets = isCurrent ? offsets : ZERO_OFFSETS;
            return (
              <div key={m} className={layerClass}>
                <TickLogoSvg
                  mood={m}
                  pupilOffsets={pupilOffsets.length ? pupilOffsets : ZERO_OFFSETS}
                  svgRef={isCurrent ? svgRef : null}
                />
              </div>
            );
          }

          return (
            <img
              key={m}
              src={MOOD_SRCS[m]}
              alt={`TIMES logo — ${m}`}
              className={layerClass}
              draggable={false}
            />
          );
        })}
      </div>
    </div>
  );
}
