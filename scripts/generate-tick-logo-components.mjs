#!/usr/bin/env node
/**
 * Converts public/logo/TICK-{mood}.svg into React components with
 * animatable pupil groups (translate transform).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LOGO_DIR = path.join(ROOT, 'public/logo');
const OUT_DIR = path.join(ROOT, 'src/components/ui/tick-logos');

const MOODS = ['happy', 'love', 'wow', 'wink', 'sleep'];

const PUPIL_RE = /<circle\b[^>]*\bcx="([^"]+)"\s+cy="([^"]+)"\s+r="5\.76"[^>]*\/>/g;

/** Visible pupil anchors per mood (hidden Illustrator layers use display:none). */
const VISIBLE_PUPILS = {
  happy: [
    { cx: '217.6', cy: '268.8', index: 0 },
    { cx: '320', cy: '268.8', index: 1 },
  ],
  love: [
    { cx: '217.6', cy: '268.8', index: 0 },
    { cx: '320', cy: '268.8', index: 1 },
  ],
  wow: [
    { cx: '217.6', cy: '248.53', index: 0 },
    { cx: '320', cy: '248.53', index: 1 },
  ],
  wink: [
    { cx: '218.67', cy: '268.8', index: 0 },
  ],
  sleep: [],
};

function toJsxAttr(name) {
  const map = {
    'class': 'className',
    'clip-path': 'clipPath',
    'clip-rule': 'clipRule',
    'fill-rule': 'fillRule',
    'stop-color': 'stopColor',
    'stop-opacity': 'stopOpacity',
    'stroke-width': 'strokeWidth',
    'stroke-linecap': 'strokeLinecap',
    'stroke-miterlimit': 'strokeMiterlimit',
    'stroke-opacity': 'strokeOpacity',
    'stroke-dasharray': 'strokeDasharray',
    'xlink:href': 'href',
    'xmlns:xlink': 'xmlnsXlink',
    'gradient-units': 'gradientUnits',
    'gradient-transform': 'gradientTransform',
    'filter': 'filter',
  };
  return map[name] || name;
}

function prefixIds(svg, prefix) {
  let out = svg;
  const ids = new Set();
  out.replace(/\bid="([^"]+)"/g, (_, id) => { ids.add(id); return _; });
  for (const id of ids) {
    const pid = `${prefix}-${id}`;
    out = out.replaceAll(`id="${id}"`, `id="${pid}"`);
    out = out.replaceAll(`url(#${id})`, `url(#${pid})`);
    out = out.replaceAll(`xlink:href="#${id}"`, `xlink:href="#${pid}"`);
    out = out.replaceAll(`href="#${id}"`, `href="#${pid}"`);
  }
  return out;
}

function attrsToJsx(tag) {
  return tag.replace(/([\w:-]+)=/g, (m, attr) => `${toJsxAttr(attr)}=`);
}

function wrapPupils(svg, mood) {
  const visible = VISIBLE_PUPILS[mood] ?? [];
  const visibleKey = (cx, cy) => visible.find((p) => p.cx === cx && p.cy === cy);

  return svg.replace(PUPIL_RE, (match, cx, cy) => {
    const circle = match.replace(/\bclass="/g, 'className="');
    const anchor = visibleKey(cx, cy);
    if (!anchor) return circle;
    return `{/* pupil-${anchor.index} */}
      <g transform={\`translate(\${pupilOffsets[${anchor.index}]?.x ?? 0}, \${pupilOffsets[${anchor.index}]?.y ?? 0})\`}>
        ${circle}
      </g>`;
  });
}

function svgToJsxBody(svg, mood) {
  let body = svg
    .replace(/<\?xml[^?]*\?>\s*/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();

  // Remove outer <svg> wrapper — we'll add our own.
  body = body.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  // style block: class -> className in CSS is fine as-is inside <style>
  body = body.replace(/<style>/g, '<style>{`').replace(/<\/style>/g, '`}</style>');

  // Convert attributes on tags (rough pass)
  body = body.replace(/<([a-zA-Z][\w:-]*)([^>]*)\/?>/g, (full, tag, attrs) => {
    if (tag === 'style') return full;
    let a = attrs
      .replace(/\bclass=/g, 'className=')
      .replace(/\bclip-path=/g, 'clipPath=')
      .replace(/\bfill-rule=/g, 'fillRule=')
      .replace(/\bstop-color=/g, 'stopColor=')
      .replace(/\bstop-opacity=/g, 'stopOpacity=')
      .replace(/\bstroke-width=/g, 'strokeWidth=')
      .replace(/\bstroke-linecap=/g, 'strokeLinecap=')
      .replace(/\bstroke-miterlimit=/g, 'strokeMiterlimit=')
      .replace(/\bstroke-opacity=/g, 'strokeOpacity=')
      .replace(/\bstroke-dasharray=/g, 'strokeDasharray=')
      .replace(/\bgradient-units=/g, 'gradientUnits=')
      .replace(/\bgradient-transform=/g, 'gradientTransform=')
      .replace(/\bxmlns:xlink=/g, 'xmlnsXlink=')
      .replace(/\bxlink:href=/g, 'href=');
    return `<${tag}${a}>`;
  });

  body = wrapPupils(body, mood);
  return body;
}

function generateMood(mood) {
  const src = fs.readFileSync(path.join(LOGO_DIR, `TICK-${mood}.svg`), 'utf8');
  let prefixed = prefixIds(src, mood);
  const body = svgToJsxBody(prefixed, mood);

  const component = `/* eslint-disable */
// Auto-generated from public/logo/TICK-${mood}.svg — do not edit by hand.
import React from 'react';

export default function TickLogo${mood.charAt(0).toUpperCase() + mood.slice(1)}({ pupilOffsets = [{ x: 0, y: 0 }, { x: 0, y: 0 }], svgRef }) {
  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
${body}
    </svg>
  );
}
`;

  fs.writeFileSync(path.join(OUT_DIR, `TickLogo${capitalize(mood)}.jsx`), component);
  console.log(`Generated TickLogo${capitalize(mood)}.jsx`);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const mood of MOODS) {
  generateMood(mood);
}

// Index + wrapper
const index = `${MOODS.map(m => `import TickLogo${capitalize(m)} from './TickLogo${capitalize(m)}.jsx';`).join('\n')}

const MOOD_COMPONENTS = {
${MOODS.map(m => `  ${m}: TickLogo${capitalize(m)},`).join('\n')}
};

export { MOOD_COMPONENTS };
export default MOOD_COMPONENTS;
`;

fs.writeFileSync(path.join(OUT_DIR, 'index.js'), index);
console.log('Done.');
