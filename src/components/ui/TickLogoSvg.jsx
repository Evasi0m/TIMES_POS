import React from 'react';
import { MOOD_COMPONENTS } from './tick-logos/index.js';

const ZERO_OFFSETS = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

/**
 * Inline TICK mascot SVG with animatable pupils.
 * One component per mood lives in ./tick-logos/ (generated from public/logo/).
 */
export default function TickLogoSvg({
  mood = 'happy',
  pupilOffsets = ZERO_OFFSETS,
  svgRef,
}) {
  const Logo = MOOD_COMPONENTS[mood];
  if (!Logo) return null;

  return <Logo pupilOffsets={pupilOffsets} svgRef={svgRef} />;
}
