// one renderer for every marker, glyph and map, so the spec and the app cannot drift apart
const C={web:"var(--l0)",ob:"var(--l1)",gp:"var(--l2)",lm:"var(--l3)",out:"var(--ink-3)"},W={out:3,front:7,core:12};
// Lucide icon paths (ISC), on a 24 grid
const IC={hub:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
 att:'<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>',
 time:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 cash:'<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
 exit:'<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
 plan:'<path d="M5 12h14"/><path d="M12 5v14"/>',
 card:'<rect width="20" height="14" x="2" y="5" rx="2"/><path d="M2 10h20"/>',
 min:'<path d="m14 10 7-7"/><path d="M20 10h-6V4"/><path d="m3 21 7-7"/><path d="M4 14h6v6"/>',
 dec:'<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
 race:'<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
 ab:'<path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
 ok:'<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
 link:'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
 bot:'<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
 me:'<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 retry:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
 pause:'<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
 branch:'<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
 ver:'<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
 stop:'<path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
 rep:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'};
const icon=(k,x,y,s)=>`<g class="ic" transform="translate(${x-s/2} ${y-s/2}) scale(${s/24})">${IC[k]}</g>`;
const R={hub:21,att:14,time:15,cash:16,exit:13,plan:14,dec:15,race:15,par:6,ab:14,ok:15,link:15};
function octPts(a,b){const[x1,y1]=a,[x2,y2]=b,dx=x2-x1,dy=y2-y1;if(!dy||!dx)return[a,b];
 const d=Math.min(Math.abs(dy),Math.abs(dx)),f=(Math.abs(dx)-d)/2,s=Math.sign(dx);return[a,[x1+s*f,y1],[x1+s*(f+d),y2],b]}
function rnd(p,r=18){p=p.filter((q,i)=>!i||q[0]!==p[i-1][0]||q[1]!==p[i-1][1]);let d=`M${p[0][0]} ${p[0][1]}`;for(let i=1;i<p.length-1;i++){const[a,b,c]=[p[i-1],p[i],p[i+1]],
 l1=Math.hypot(b[0]-a[0],b[1]-a[1]),l2=Math.hypot(c[0]-b[0],c[1]-b[1]),k=Math.min(r,l1/2,l2/2),
 u=[b[0]-(b[0]-a[0])/l1*k,b[1]-(b[1]-a[1])/l1*k],v=[b[0]+(c[0]-b[0])/l2*k,b[1]+(c[1]-b[1])/l2*k];d+=`L${u[0]} ${u[1]}Q${b[0]} ${b[1]} ${v[0]} ${v[1]}`}
 const e=p[p.length-1];return d+`L${e[0]} ${e[1]}`}
const oct=(a,b)=>rnd(octPts(a,b));
function marker(s,click){const{x,t}=s,sp=s.span||[s.y,s.y],r=R[t],cy=(sp[0]+sp[1])/2,y0=t==="par"?cy-17:sp[0]-r,h=t==="par"?34:sp[1]-sp[0]+2*r;
 const rx=t==="cash"||t==="ok"?8:r,w=t==="exit"?36:t==="par"?10:2*r,D=r*1.4;
 // logic marks: a diamond decides (hollow: a condition; filled: the first event wins); a bar splits or joins lanes
 const shape=c=>t==="dec"||t==="race"?`<path class="${c}" d="M${x} ${cy-D}L${x+D} ${cy}L${x} ${cy+D}L${x-D} ${cy}Z"/>`:`<rect class="${c}" x="${x-w/2}" y="${y0}" width="${w}" height="${h}" rx="${Math.min(rx,w/2)}"/>`;
 // a bundle is one money station that starts several lines: a stacked $ card
 let g=`<g class="mk m-${t}${s.bad?" bad":""}${s.bundle?" bundle":""}"${click&&s.id?` data-id="${s.id}" tabindex="0" role="button" aria-label="${s.n||t}"`:""}>${s.bundle||t==="link"?`<rect class="stk" x="${x-w/2+5}" y="${y0-5}" width="${w}" height="${h}" rx="${rx}"/>`:""}${shape("ring")}${shape("b")}${t==="par"?"":icon(t,x,cy,t==="hub"?22:t==="exit"?15:16)}${s.rule?rule(x,y0-14,s.rule):""}</g>`;
 if(s.rep)g+=chip(x,sp[1]+r+17,s.rep,s.ri);
 if(s.plans)g+=chip(x,sp[1]+r+17+(s.rep?26:0),s.plans,"card");
 if(s.n){const p=s.p||"up",top=y0,bot=y0+h,a=p==="right"?"start":p==="left"?"end":"middle",lx=p==="right"?x+w/2+10:p==="left"?x-w/2-10:x;
  const ny=p==="up"?top-10-(s.s?15:0):p==="down"?bot+19+(s.rep?26:0)+(s.plans?26:0):cy+(s.s?-3:5);
  g+=`<text class="lab" x="${lx}" y="${ny}" text-anchor="${a}">${s.n}</text>`+(s.s?`<text class="sub" x="${lx}" y="${ny+15}" text-anchor="${a}">${s.s}</text>`:"")}
 return g}
function chip(x,y,t,ic="rep"){if(!ic){const w=t.length*6.3+18;return`<g class="chip"><rect x="${x-w/2}" y="${y-10.5}" width="${w}" height="21" rx="10.5"/><text x="${x}" y="${y+4}" text-anchor="middle">${t}</text></g>`}
 const w=t.length*6.3+30;return`<g class="chip"><rect x="${x-w/2}" y="${y-10.5}" width="${w}" height="21" rx="10.5"/>${icon(ic,x-w/2+13,y,11)}<text x="${x-w/2+22}" y="${y+4}">${t}</text></g>`}
// the rule of a split or join: all, any, or N of M, in small caps on an ink tag
const rule=(x,y,t)=>{const w=t.length*7.4+14;return`<g class="rule"><rect x="${x-w/2}" y="${y-9}" width="${w}" height="18" rx="5"/><text x="${x}" y="${y+3.6}" text-anchor="middle">${t.toUpperCase()}</text></g>`};
function pill(x,y,who,late,id=""){const[o,tm]=who.split(" · "),w=tm.length*7+42;return`<g class="pill${late?" late":""}"${id}><rect x="${x-w/2}" y="${y-13}" width="${w}" height="26" rx="13"/><circle class="av" cx="${x-w/2+13}" cy="${y}" r="10"/><text class="avt" x="${x-w/2+13}" y="${y+3.5}" text-anchor="middle">${o}</text><text class="t" x="${x-w/2+28}" y="${y+4.5}">${tm}</text></g>`}
// transfer: a 45° connector from the source that merges into the target line, labelled with a pill in the target colour
function xfer(a,c,l,lab,id="",f=.62){const dy=c[1]-a[1],dx=c[0]-a[0],k=Math.min(Math.abs(dy),Math.abs(dx)),e=[a[0]+Math.sign(dx)*k,c[1]],d=rnd([a,e,c],22),m=[a[0]+(e[0]-a[0])*f,a[1]+(e[1]-a[1])*f],w=lab.length*6.6+20;
 return[`<path class="case" data-l="${l}" d="${d}" style="stroke-width:10"/>`,`<path class="xfer" data-l="${l}" d="${d}" style="stroke:${C[l]}"/>`,`<g class="xp" data-l="${l}"${id}><rect x="${m[0]-w/2}" y="${m[1]-10.5}" width="${w}" height="21" rx="10.5" style="fill:${C[l]}"/><text x="${m[0]}" y="${m[1]+4}" text-anchor="middle">${lab}</text></g>`]}
function draw(sc){const S=Object.fromEntries(sc.st.map(s=>[s.id,s])),P=(id,o=0)=>[S[id].x,S[id].y+o];let z="",cs="",t="",b="",s="",mv="";
 const H=sc.h,Wd=sc.w||960;
 (sc.zones||[]).forEach(([x0,x1,n],i)=>z+=(i?`<line class="zl" x1="${x0}" y1="6" x2="${x0}" y2="${H-22}"/>`:"")+`<text class="zt" x="${x0+(i?8:0)}" y="${H-8}">${n}</text>`);
 sc.tr.forEach((r,i)=>{const a=r.pa||(r.a?P(r.a,r.oa||r.o||0):r.pts[0]),c=r.pc||(r.b?P(r.b,r.ob||r.o||0):r.pts?r.pts.at(-1):a);
  const id=sc.click&&r.id?` data-tr="${r.id}"`:"",fid=id&&id+` tabindex="0" role="button"`,hit=d=>id?`<path class="hit"${id} d="${d}"/>`:"";
  if(r.k==="xfer"){const[x1,x2,x3]=xfer(a,c,r.l,r.lab,fid,r.f);cs+=x1;t+=x2+hit(x2.match(/ d="([^"]+)"/)[1]);b+=x3;return}
  if(r.k==="exit"){const d=r.pts?rnd(r.pts):oct(a,c);if(r.cond){const m=r.cat||[(a[0]+c[0])/2,(a[1]+c[1])/2];b+=`<g class="cond">${chip(m[0],m[1],r.cond,r.ci||null)}</g>`}t+=`<path class="spur${r.b&&S[r.b].bad?" bad":""}" d="${d}"/>`+hit(d);return}
  const d=r.pts?rnd(r.pts,r.r):r.path?r.path:oct(a,c),w=W[r.w];
  cs+=`<path class="case" data-l="${r.l}" d="${d}" style="stroke-width:${w+6}"/>`;t+=`<path class="trk${r.k==="plan"?" plan":r.k==="ab"?" ab":r.k==="stub"?" stub":""}" data-l="${r.l}" d="${d}" style="stroke:${C[r.l]};stroke-width:${w}"/>`+hit(d);
  if(r.k!=="plan"&&(r.l!=="out"||r.mv)&&!(sc.still&&!r.mv)){const n=r.dots||1,du=r.dur||4+i%3;for(let j=0;j<n;j++)mv+=`<circle class="mv" data-l="${r.l}" r="${r.w==="core"?3.4:r.l==="out"?3:2.6}"><animateMotion dur="${du}s" begin="${-j*du/n-i*.7}s" repeatCount="indefinite" path="${d}"/></circle>`;}
  if(r.cond){const m=r.cat||[(a[0]+c[0])/2,(a[1]+c[1])/2];b+=`<g class="cond${r.cond==="else"?" else":""}">${chip(m[0],m[1],r.cond,r.ci||null)}</g>`}
  if(r.who&&r.who!=="auto"){const m=r.at||[(a[0]+c[0])/2,(a[1]+c[1])/2];b+=pill(m[0],m[1]+(r.bdy||0),r.who,r.late,fid)}});
 sc.st.forEach(x=>s+=x.cap?capsule(x):x.ring?ring(x):x.badge?badge(x):marker(x,sc.click));
 const defs=Object.entries(C).map(([k,v])=>`<marker id="ar-${k}" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L9 5L1 9z" style="fill:${v}"/></marker>`).join("")+`<pattern id="dg" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1"/></pattern>`;
 return`<svg class="mm" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${sc.title||"map"}"><defs>${defs}</defs><rect width="${Wd}" height="${H}" fill="url(#dg)"/>${z}${cs}${t}${mv}${sc.extra||""}${s}${b}</svg>`}
// zoom: a collapsed run of stations is one capsule, first to last station, with its name and the people inside now.
// Zoom hides stations, never lines. Tracks, transfers and exits attach to the capsule. A late person track inside rings it amber.
const zin=c=>c.grp?` data-id="${c.id}" data-grp="${c.grp}"`:"";
// a loop folded by zoom: one ring in the line colour, repeat icon inside
// leaf rect: small radius top-left and bottom-right, large on the other two, as in the mark
function leaf(x,y,w,h,a,b,at=""){b=Math.min(b,h/2,w/2);return`<path${at} d="M${x+a} ${y}H${x+w-b}A${b} ${b} 0 0 1 ${x+w} ${y+b}V${y+h-a}A${a} ${a} 0 0 1 ${x+w-a} ${y+h}H${x+b}A${b} ${b} 0 0 1 ${x} ${y+h-b}V${y+a}A${a} ${a} 0 0 1 ${x+a} ${y}Z"/>`}
function ring(c){const r=c.r||26;return`<g class="cap ring" data-l="${c.l}"${zin(c)} tabindex="0" role="button" aria-label="${c.n}. Open"><circle class="cr" cx="${c.x}" cy="${c.y}" r="${r+5}"/><circle class="cb" cx="${c.x}" cy="${c.y}" r="${r}" style="stroke:${C[c.l]};stroke-width:7"/>${icon("rep",c.x,c.y,20)}<text class="lab" x="${c.x}" y="${c.y-r-26}" text-anchor="middle">${c.n}</text><text class="sub" x="${c.x}" y="${c.y-r-11}" text-anchor="middle">${c.s||""}</text></g>`}
// a whole offer folded by zoom: one badge with its name, price and clients
function badge(c){const w=c.w||280,h=56,X=c.x-w/2,Y=c.y-h/2;return`<g class="cap bdg" data-l="${c.l}"${zin(c)} tabindex="0" role="button" aria-label="${c.n}. Open"><rect class="cr" x="${X-5}" y="${Y-5}" width="${w+10}" height="${h+10}" rx="17"/><rect class="cb" x="${X}" y="${Y}" width="${w}" height="${h}" rx="12" style="stroke:${C[c.l]};stroke-width:4"/><rect x="${X+12}" y="${Y+12}" width="32" height="32" rx="8" style="fill:${C[c.l]}"/><g class="bi">${icon(c.ic||"rep",X+28,c.y,17)}</g><text class="bn" x="${X+56}" y="${c.y-3}">${c.n}</text><text class="bs" x="${X+56}" y="${c.y+15}">${c.s}</text></g>`}
function capsule(c){const[x0,x1]=c.cap,h=30,X=x0-16,w=x1-x0+32,m=(x0+x1)/2;
 return`<g class="cap${c.late?" late":""}" data-l="${c.l}" data-g="${c.id}"${zin(c)} tabindex="0" role="button" aria-label="${c.n}: ${c.now} people. Open"><rect class="cr" x="${X-4}" y="${c.y-h/2-4}" width="${w+8}" height="${h+8}" rx="${h/2+4}"/><rect class="cb" x="${X}" y="${c.y-h/2}" width="${w}" height="${h}" rx="${h/2}" style="stroke:${C[c.l]}"/><text class="cn" x="${m}" y="${c.y+4.5}" text-anchor="middle">${c.now}</text><text class="lab" x="${m}" y="${c.y-h/2-10}" text-anchor="middle">${c.n}</text></g>`}
// level 2 = every station; 1 = the named groups (station.g); 0 = one run per line per part column. Exits and the hub never fold.
function zoom(sc,level,open=new Set()){if(level>=2)return sc;
 const col=x=>sc.zones.findIndex(([a,b])=>x>=a&&x<b),key=s=>s.t==="hub"||s.t==="exit"||!s.ln?null:level===1?s.g:s.ln+"@"+col(s.x);
 const G={};sc.st.forEach(s=>{const k=key(s);if(k&&!open.has(k))(G[k]=G[k]||[]).push(s)});
 const into={},caps=[];for(const[k,m]of Object.entries(G)){if(m.length<2)continue;const L=sc.lines[m[0].ln],xs=m.map(s=>s.x),ids=new Set(m.map(s=>s.id));
  const late=sc.tr.some(r=>r.late&&ids.has(r.a)&&ids.has(r.b));
  caps.push({id:k,cap:[Math.min(...xs),Math.max(...xs)],x:(Math.min(...xs)+Math.max(...xs))/2,y:m[0].y,l:L.l,late,now:m.reduce((a,s)=>a+(s.now||0),0),
   n:level===1?sc.groups[k]:L.l==="out"?L.n:L.n+" · "+sc.zones[col(m[0].x)][2].toLowerCase().replace(/^./,c=>c.toUpperCase())});m.forEach(s=>into[s.id]=k)}
 const O=Object.fromEntries(sc.st.map(s=>[s.id,s])),cap=Object.fromEntries(caps.map(c=>[c.id,c]));
 const pt=(id,o,other)=>{const k=into[id];if(!k)return[O[id].x,O[id].y+o];const c=cap[k];return[Math.min(Math.max(O[other].x,c.cap[0]),c.cap[1]),c.y]};
 const tr=sc.tr.flatMap(r=>{if(r.b&&into[r.a]&&into[r.a]===into[r.b])return[];if(!into[r.a]&&!into[r.b])return[r];
  return[{...r,pts:undefined,at:undefined,pa:pt(r.a,r.oa||r.o||0,r.b),pc:pt(r.b,r.ob||r.o||0,r.a)}]});
 return{...sc,st:sc.st.filter(s=>!into[s.id]).concat(caps),tr}}
// hover a line: light it, dim the rest (route focus, as in map apps)
function focusable(root){root.querySelectorAll("svg.mm").forEach(v=>{v.addEventListener("pointerover",e=>{const l=e.target.closest("[data-l]")?.dataset.l;
 v.classList.toggle("focus",!!l);v.querySelectorAll("[data-l]").forEach(n=>n.classList.toggle("on",n.dataset.l===l))});v.addEventListener("pointerleave",()=>v.classList.remove("focus"))})}

// a fold handle on an open group: click it to fold the group back
const foldTab=(x,y,t,grp)=>{const w=t.length*6.9+46;return`<g class="fold" data-fold="${grp}" tabindex="0" role="button" aria-label="Fold ${t}">${leaf(x-w/2,y-15,w,30,4,14,' class="lf"')}${icon("min",x-w/2+18,y,15)}<text x="${x-w/2+32}" y="${y+4.5}">${t}</text></g>`};
