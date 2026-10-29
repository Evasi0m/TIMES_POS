/**
 * TICK mascot — rounded-octagon watch body, generated as an SVG string so the
 * same art feeds the React logo and the exported files in public/logo/.
 * Below 40px the shading and sparkles are dropped so it stays crisp.
 */

export const MOODS = ['happy', 'love', 'wink', 'wow', 'sleep'];

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
function eye(cx, cy, u, detail, rx=35, ry=43) {
  return `<g>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#e${u})"/>
    ${detail ? `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#000" stroke-opacity=".35" stroke-width="2"/>
    <ellipse cx="${cx+3}" cy="${cy+ry*.55}" rx="${rx*.55}" ry="${ry*.18}" fill="#ff7a3a" opacity=".22"/>
    <path d="M${cx-9} ${cy-20}l3.2 8.6 8.6 3.2-8.6 3.2-3.2 8.6-3.2-8.6-8.6-3.2 8.6-3.2z" fill="#fff"/>
    <circle cx="${cx+10}" cy="${cy+12}" r="4.6" fill="#e1fbff"/>
    <circle cx="${cx+15}" cy="${cy-14}" r="2.2" fill="#fff" opacity=".7"/>` :
    `<circle cx="${cx-8}" cy="${cy-12}" r="8" fill="#fff"/>`}
  </g>`;
}
function eyes(mood, detail, u) {
  const lid = 'fill="none" stroke="#1a0602" stroke-width="12" stroke-linecap="round"';
  const heart = cx => `<path d="M${cx} 282c-31-19-43-33-43-47 0-12 10-21 21-21 9 0 17 5 22 12 5-7 13-12 22-12 11 0 21 9 21 21 0 14-12 28-43 47z" fill="url(#lv${u})"/>
    ${detail ? `<ellipse cx="${cx-15}" cy="231" rx="8" ry="5" fill="#fff" opacity=".75" transform="rotate(-25 ${cx-15} 231)"/>` : ''}`;
  switch (mood) {
    case 'happy': return `<g class="eyes-open">${eye(205,252,u,detail)}${eye(309,252,u,detail)}</g>`;
    case 'love':  return heart(205) + heart(309);
    case 'wink':  return eye(205,252,u,detail) + `<path d="M283 256q26-20 52 0" ${lid}/>`;
    case 'wow':   return eye(203,250,u,detail,34,38) + eye(311,250,u,detail,34,38);
    case 'sleep': return `<path d="M180 254q25 18 50 0" ${lid}/><path d="M284 254q25 18 50 0" ${lid}/>
      ${detail ? `<g class="zz" font-family="Arial Rounded MT Bold, Arial, sans-serif" font-weight="900" fill="#fff" opacity=".9">
        <text x="350" y="188" font-size="40">z</text><text x="378" y="158" font-size="28" opacity=".75">z</text></g>` : ''}`;
  }
}

export function tickSvg({ size = 160, mood = 'happy', anim = false, id } = {}) {
  const detail = size >= 40;
  const u = id || Math.random().toString(36).slice(2,7);
  return `<svg xmlns="http://www.w3.org/2000/svg" class="tick${anim ? ' float' : ''}" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-label="TICK logo — ${mood}">
  <defs>
    <radialGradient id="b${u}" cx=".38" cy=".3" r=".85">
      <stop offset="0" stop-color="#ff7d27"/><stop offset=".5" stop-color="#ee4e00"/><stop offset="1" stop-color="#d62200"/>
    </radialGradient>
    <radialGradient id="sh${u}" cx=".72" cy=".86" r=".6">
      <stop offset="0" stop-color="#8e1400" stop-opacity=".3"/><stop offset="1" stop-color="#8e1400" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="h${u}" cx=".27" cy=".17" r=".42">
      <stop offset="0" stop-color="#fff" stop-opacity=".62"/><stop offset=".45" stop-color="#ffe3cc" stop-opacity=".18"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rim${u}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#ffb37a" stop-opacity=".45"/>
    </linearGradient>
    <linearGradient id="c${u}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c83400"/><stop offset=".35" stop-color="#ff8a40"/><stop offset=".7" stop-color="#f05a10"/><stop offset="1" stop-color="#b02800"/>
    </linearGradient>
    <radialGradient id="e${u}" cx=".4" cy=".35" r=".75">
      <stop offset="0" stop-color="#3a1206"/><stop offset=".7" stop-color="#180502"/><stop offset="1" stop-color="#0a0201"/>
    </radialGradient>
    <linearGradient id="lv${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff4d6d"/><stop offset="1" stop-color="#c8002e"/>
    </linearGradient>
    <radialGradient id="sp${u}"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="bv${u}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#7a1500" stop-opacity=".28"/>
    </linearGradient>
    <clipPath id="cl${u}"><path d="${oct()}"/></clipPath>
  </defs>
  ${anim ? '<ellipse class="shadow" cx="256" cy="474" rx="130" ry="12" fill="#5a1a00" opacity=".16"/>' : ''}
  <g class="body-g">
    <g class="crown">
      <rect x="432" y="228" width="40" height="64" rx="13" fill="url(#c${u})"/>
      ${detail ? `<g stroke="#7a1500" stroke-opacity=".35" stroke-width="3" stroke-linecap="round">
        <path d="M444 236v48M452 236v48M460 236v48"/></g>
        <rect x="432" y="228" width="40" height="64" rx="13" fill="none" stroke="#7a1500" stroke-opacity=".4" stroke-width="2"/>
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
    <path d="${oct(24,41)}" fill="none" stroke="#7a1500" stroke-opacity=".12" stroke-width="2"/>
    <path d="${oct()}" fill="none" stroke="#7a1500" stroke-opacity=".35" stroke-width="2"/>` : ''}
    <g class="face" transform="translate(-8 4)">${eyes(mood, detail, u)}</g>
  </g>
</svg>`;
}
