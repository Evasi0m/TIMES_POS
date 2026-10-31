/**
 * TICK mascot — rounded-octagon watch body, generated as an SVG string so the
 * same art feeds the React logo and the exported files in public/logo/.
 * Below 40px the shading and sparkles are dropped so it stays crisp.
 */

export const MOODS = ['happy', 'love', 'wink', 'wow', 'sleep'];

export const THEMES = ['orange', 'white', 'black'];

// Pink hearts; orange overrides with dark hearts (pink vanishes on orange).
const HEART = ['#ff4d6d', '#c8002e'];

// Colour sets per body finish. Eyes flip to light on the black body.
const PALETTES = {
  orange: { body: ['#ff7d27', '#ee4e00', '#d62200'], shade: '#8e1400', edge: '#7a1500', rimEnd: '#ffb37a',
    crown: ['#c83400', '#ff8a40', '#f05a10', '#b02800'], eye: ['#3a1206', '#180502', '#0a0201'], eyeEdge: '#000',
    glow: '#ff7a3a', spark: '#fff', dot: '#e1fbff', lid: '#1a0602', zz: '#fff', hi: .62,
    heart: ['#3a1206', '#0a0201'] },
  white:  { body: ['#ffffff', '#f3f1ee', '#d9d4ce'], shade: '#6b6158', edge: '#8a8078', rimEnd: '#ffffff',
    crown: ['#bdb6af', '#ffffff', '#e8e4df', '#a9a199'], eye: ['#3a3633', '#1a1816', '#0b0a09'], eyeEdge: '#000',
    glow: '#9b918a', spark: '#fff', dot: '#e1fbff', lid: '#1a1816', zz: '#8a8078', hi: .9 },
  black:  { body: ['#4a4a4d', '#2a2a2c', '#141415'], shade: '#000000', edge: '#000000', rimEnd: '#8a8a90',
    crown: ['#1c1c1e', '#6a6a70', '#3a3a3e', '#111113'], eye: ['#ffffff', '#f2f0ec', '#cfcac3'], eyeEdge: '#000',
    glow: '#ffffff', spark: '#2a2a2c', dot: '#ff7d27', lid: '#f2f0ec', zz: '#f2f0ec', hi: .28 },
};

// Rounded octagon inside the 68..444 × 72..448 box; inset shrinks it evenly.
function oct(i=0, r=54) {
  const x0=68+i, y0=72+i, x1=444-i, y1=448-i, c=96-i*.42;
  const P=[[x0+c,y0],[x1-c,y0],[x1,y0+c],[x1,y1-c],[x1-c,y1],[x0+c,y1],[x0,y1-c],[x0,y0+c]];
  const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];
  let d='';
  P.forEach((pt,k)=>{
    const prev=P[(k+7)%8], next=P[(k+1)%8];
    const lp=Math.hypot(pt[0]-prev[0],pt[1]-prev[1]), ln=Math.hypot(next[0]-pt[0],next[1]-pt[1]);
    const a=lerp(pt,prev,r/lp), b=lerp(pt,next,r/ln);
    d+=(k?'L':'M')+a.map(n=>n.toFixed(1)).join(' ')+'Q'+pt.join(' ')+' '+b.map(n=>n.toFixed(1)).join(' ');
  });
  return d+'Z';
}
function eye(cx, cy, u, detail, T, rx=35, ry=43) {
  return `<g>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#e${u})"/>
    ${detail ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${T.eyeEdge}" stroke-opacity=".35" stroke-width="2"/>
    <ellipse cx="${cx+3}" cy="${cy+ry*.55}" rx="${rx*.55}" ry="${ry*.18}" fill="${T.glow}" opacity=".22"/>
    <path d="M${cx-9} ${cy-20}l3.2 8.6 8.6 3.2-8.6 3.2-3.2 8.6-3.2-8.6-8.6-3.2 8.6-3.2z" fill="${T.spark}"/>
    <circle cx="${cx+10}" cy="${cy+12}" r="4.6" fill="${T.dot}"/>
    <circle cx="${cx+15}" cy="${cy-14}" r="2.2" fill="${T.spark}" opacity=".7"/>` :
    `<circle cx="${cx-8}" cy="${cy-12}" r="8" fill="${T.spark}"/>`}
  </g>`;
}
function eyes(mood, detail, u, T) {
  const lid = `fill="none" stroke="${T.lid}" stroke-width="12" stroke-linecap="round"`;
  const heart = cx => `<path d="M${cx} 282c-31-19-43-33-43-47 0-12 10-21 21-21 9 0 17 5 22 12 5-7 13-12 22-12 11 0 21 9 21 21 0 14-12 28-43 47z" fill="url(#lv${u})"/>
    ${detail ? `<ellipse cx="${cx-15}" cy="231" rx="8" ry="5" fill="#fff" opacity=".75" transform="rotate(-25 ${cx-15} 231)"/>` : ''}`;
  switch (mood) {
    case 'happy': return `<g class="eyes-open">${eye(205,252,u,detail,T)}${eye(309,252,u,detail,T)}</g>`;
    case 'love':  return heart(205) + heart(309);
    case 'wink':  return eye(205,252,u,detail,T) + `<path d="M283 256q26-20 52 0" ${lid}/>`;
    case 'wow':   return eye(203,250,u,detail,T,34,38) + eye(311,250,u,detail,T,34,38);
    case 'sleep': return `<path d="M180 254q25 18 50 0" ${lid}/><path d="M284 254q25 18 50 0" ${lid}/>
      ${detail ? `<g class="zz" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" fill="${T.zz}" opacity=".9">
        <text x="350" y="188" font-size="40">z</text><text x="378" y="158" font-size="28" opacity=".75">z</text></g>` : ''}`;
  }
}

export function tickSvg({ size = 160, mood = 'happy', theme = 'orange', anim = false, id } = {}) {
  const T = PALETTES[theme] || PALETTES.orange;
  const detail = size >= 40;
  const u = id || Math.random().toString(36).slice(2,7);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="tick${anim ? ' float' : ''}" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="TICK logo — ${mood}">
  <defs>
    <radialGradient id="b${u}" cx=".38" cy=".3" r=".85">
      <stop offset="0" stop-color="${T.body[0]}"/><stop offset=".5" stop-color="${T.body[1]}"/><stop offset="1" stop-color="${T.body[2]}"/>
    </radialGradient>
    <radialGradient id="sh${u}" cx=".72" cy=".86" r=".6">
      <stop offset="0" stop-color="${T.shade}" stop-opacity=".3"/><stop offset="1" stop-color="${T.shade}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="h${u}" cx=".27" cy=".17" r=".42">
      <stop offset="0" stop-color="#fff" stop-opacity="${T.hi}"/><stop offset=".45" stop-color="#ffe3cc" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim${u}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="${T.rimEnd}" stop-opacity=".45"/>
    </linearGradient>
    <linearGradient id="c${u}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${T.crown[0]}"/><stop offset=".35" stop-color="${T.crown[1]}"/><stop offset=".7" stop-color="${T.crown[2]}"/><stop offset="1" stop-color="${T.crown[3]}"/>
    </linearGradient>
    <radialGradient id="e${u}" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="${T.eye[0]}"/><stop offset=".7" stop-color="${T.eye[1]}"/><stop offset="1" stop-color="${T.eye[2]}"/>
    </radialGradient>
    <linearGradient id="lv${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${(T.heart || HEART)[0]}"/><stop offset="1" stop-color="${(T.heart || HEART)[1]}"/>
    </linearGradient>
    <radialGradient id="sp${u}"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="bv${u}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="${T.edge}" stop-opacity=".28"/>
    </linearGradient>
    <clipPath id="cl${u}"><path d="${oct()}"/></clipPath>
  </defs>
  ${anim ? '<ellipse class="shadow" cx="256" cy="474" rx="130" ry="12" fill="#5a1a00" opacity=".16"/>' : ''}
  <g class="body-g">
    <g class="crown">
      <rect x="432" y="228" width="40" height="64" rx="13" fill="url(#c${u})"/>
      ${detail ? `<g stroke="${T.edge}" stroke-opacity=".35" stroke-width="3" stroke-linecap="round">
        <path d="M444 236v48M452 236v48M460 236v48"/></g>
        <rect x="432" y="228" width="40" height="64" rx="13" fill="none" stroke="${T.edge}" stroke-opacity=".4" stroke-width="2"/>
        <path d="M440 234h22" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>` : ''}
    </g>
    <path d="${oct()}" fill="url(#b${u})"/>
    ${detail ? `<g clip-path="url(#cl${u})">
      <rect x="68" y="72" width="376" height="376" fill="url(#sh${u})"/>
      <rect x="68" y="72" width="376" height="376" fill="url(#h${u})"/>
      <ellipse cx="350" cy="118" rx="46" ry="20" fill="url(#sp${u})" transform="rotate(30 350 118)"/>
    </g>
    <path d="${oct(2,52)}" fill="none" stroke="url(#rim${u})" stroke-width="4"/>
    <path d="${oct(14,47)}" fill="none" stroke="url(#bv${u})" stroke-width="10"/>
    <path d="${oct(20,44)}" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="3"/>
    <path d="${oct(24,41)}" fill="none" stroke="${T.edge}" stroke-opacity=".12" stroke-width="2"/>
    <path d="${oct()}" fill="none" stroke="${T.edge}" stroke-opacity=".35" stroke-width="2"/>` : ''}
    <g class="face" transform="translate(-8 4)">${eyes(mood, detail, u, T)}</g>
  </g>
</svg>`;
}
