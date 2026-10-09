/**
 * The kit (designs/2026-10-07-sites.md, "The kit"; forms in designs/2026-10-07-forms-and-pay.md):
 * one script every page and hosted form we run carries, data pages and code pages alike. The
 * Worker serves it at `/o/__kit.js`. It reads its own tag and posts to the host it came from:
 *
 * - `data-page` (a page) or `data-form` (a hosted form): a `view` on load with the utm and
 *   referrer the visit arrived on (kept for the tab's session, so later events and the form carry
 *   the first touch); `cta` on a `[data-cta]` click, `book` on a `[data-book]` click; `start` the
 *   first time someone touches a hosted form's field; `step` with its number the first time a
 *   visitor reaches each step past the first.
 * - every `form[data-wren-form]`: hidden fields filled from the link, show-when rules applied as
 *   it's filled (a hidden field is disabled, so it isn't sent), steps shown one at a time with
 *   Back and Next (Next checks that step), checked in the browser,
 *   Turnstile added when the Worker has a site key, the fields sent as JSON to `/o/__form`, then
 *   its thanks, its redirect, or its booking step.
 * - `data-embed="<slug>"`: the hosted form in a frame right after the tag, sized to fit.
 *
 * - `data-split`: the split that served this arm (the Worker picked it by the `wab` cookie, which
 *   holds only the arm); sent with every event and form so the arm's numbers count it.
 * - a hosted form's `data-fsplit` and `data-arm`: its form split and arm, sent the same way.
 *
 * No cookie of its own and no visitor id: views, not visitors. Bodies go as text/plain, so another
 * origin's page (a code page on Pages) posts with no preflight.
 */

export const KIT_PATH = "/o/__kit.js";
export const TRACK_PATH = "/o/__t";
export const FORM_PATH = "/o/__form";
export const PREVIEW_PATH = "/o/__preview/";
export const FORM_PAGE_PATH = "/o/f/";

const TK = "__WREN_TURNSTILE_KEY__";

const KIT_SOURCE = `(function(){
var s=document.currentScript;if(!s)return;
var base=new URL(s.src,location.href).origin,TK=${TK};
var q=new URLSearchParams(location.search);
var embed=s.getAttribute("data-embed");
if(embed){var p=new URLSearchParams({embed:"1"});
["utm_source","utm_medium","utm_campaign","utm_content"].forEach(function(k){var v=q.get(k);if(v)p.set(k,v)});
try{if(document.referrer)p.set("ref",document.referrer.slice(0,200))}catch(e){}
var fr=document.createElement("iframe");fr.src=base+"${FORM_PAGE_PATH}"+encodeURIComponent(embed)+"?"+p;
fr.title=s.getAttribute("data-title")||"Form";fr.loading="lazy";fr.style.cssText="width:100%;border:0;min-height:480px";
s.parentNode.insertBefore(fr,s.nextSibling);
addEventListener("message",function(e){if(e.origin===base&&e.source===fr.contentWindow&&e.data&&typeof e.data.wrenFormHeight==="number")fr.style.height=Math.ceil(e.data.wrenFormHeight)+"px"});
return}
var page=s.getAttribute("data-page"),split=s.getAttribute("data-split")||null,first=document.querySelector("form[data-form]");
var form=s.getAttribute("data-form")||(first&&first.getAttribute("data-form"))||null;
var fsplit=first&&first.getAttribute("data-fsplit")||null,arm=first&&first.getAttribute("data-arm")||null;
if(!page&&!form)return;
var K="wren_touch",touch=null;
try{touch=JSON.parse(sessionStorage.getItem(K)||"null")}catch(e){}
var ref="";try{if(document.referrer&&new URL(document.referrer).host!==location.host)ref=document.referrer.slice(0,200)}catch(e){}
var now={source:q.get("utm_source"),medium:q.get("utm_medium"),campaign:q.get("utm_campaign"),content:q.get("utm_content"),ref:q.get("ref")||ref||null};
if(!touch||now.source||now.medium){touch=now;try{sessionStorage.setItem(K,JSON.stringify(touch))}catch(e){}}
var view=crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2);
function send(name,n){var b=JSON.stringify({page:page,form:form,split:split,formSplit:fsplit,arm:arm,view:view,name:name,step:n||null,touch:touch,w:innerWidth});
if(navigator.sendBeacon&&navigator.sendBeacon(base+"${TRACK_PATH}",new Blob([b],{type:"text/plain"})))return;
fetch(base+"${TRACK_PATH}",{method:"POST",body:b,keepalive:true,headers:{"content-type":"text/plain"}}).catch(function(){})}
send("view");
document.addEventListener("click",function(e){var t=e.target,a=t&&t.closest&&t.closest("[data-cta],[data-book]");if(a)send(a.hasAttribute("data-book")?"book":"cta")},true);
if(s.hasAttribute("data-framed")&&parent!==self){var tall=function(){parent.postMessage({wrenFormHeight:document.documentElement.scrollHeight},"*")};
addEventListener("load",tall);if(window.ResizeObserver)new ResizeObserver(tall).observe(document.body);tall()}
var forms=document.querySelectorAll("form[data-wren-form]"),started=false;
if(TK&&forms.length){forms.forEach(function(f){if(f.querySelector(".cf-turnstile"))return;
var d=document.createElement("div");d.className="cf-turnstile";d.setAttribute("data-sitekey",TK);f.insertBefore(d,f.querySelector("button[type=submit]"))});
var ts=document.createElement("script");ts.src="https://challenges.cloudflare.com/turnstile/v0/api.js";ts.async=true;document.head.appendChild(ts)}
var MAP={utm_source:"source",utm_medium:"medium",utm_campaign:"campaign",utm_content:"content"};
function bad(el,t){var box=el.closest("label,fieldset")||el;el.setAttribute("aria-invalid","true");
var m=box.querySelector(".bad");if(!m){m=document.createElement("span");m.className="bad";box.appendChild(m)}m.textContent=t}
function clear(f){f.querySelectorAll(".bad").forEach(function(m){m.remove()});f.querySelectorAll("[aria-invalid]").forEach(function(el){el.removeAttribute("aria-invalid")})}
function check(f){var out=null;function no(el,t){bad(el,t);if(!out)out=el}
f.querySelectorAll("input[required]:not(:disabled),select[required]:not(:disabled),textarea[required]:not(:disabled)").forEach(function(el){
if(el.type==="checkbox"){if(!el.checked)no(el,"Tick the box to go on.")}else if(!el.value.trim())no(el,"Fill this in.");
else if(el.validity&&!el.validity.valid)no(el,el.type==="email"?"That email doesn't look right.":"Check this one.")});
f.querySelectorAll("fieldset[data-required]:not(:disabled)").forEach(function(fs){if(!fs.querySelector("input:checked"))no(fs.querySelector("input")||fs,"Pick at least one.")});
return out}
function vals(f,k){var o=[];f.querySelectorAll("[name='"+k+"']").forEach(function(el){if(el.disabled)return;if(el.type==="checkbox"||el.type==="radio"){if(el.checked)o.push(el.value)}else if(el.value&&el.value.trim())o.push(el.value.trim())});return o}
function holds(r,got){if(r.op==="filled")return got.length>0;if(r.op==="empty")return!got.length;
var w=(r.values||[]).map(function(v){return String(v).toLowerCase()}),hit=got.some(function(g){return w.indexOf(g.toLowerCase())>=0});return r.op==="is"?hit:!hit}
function seen(el,on){el.hidden=!on;el.style.display=on?"":"none"}
function rules(f){f.querySelectorAll("[data-show]").forEach(function(el){var r;try{r=JSON.parse(el.getAttribute("data-show"))}catch(x){return}
var on=holds(r,vals(f,String(r.key).replace(/[^a-z0-9_]/g,"")));seen(el,on);
if(el.tagName==="FIELDSET")el.disabled=!on;else el.querySelectorAll("input,select,textarea").forEach(function(i){i.disabled=!on})})}
function stepper(f){var st=[].slice.call(f.querySelectorAll(".step"));if(st.length<2)return null;
var sb=f.querySelector("button[type=submit]"),nav=document.createElement("div"),back=document.createElement("button"),next=document.createElement("button"),pr=document.createElement("p");
nav.className="steps-nav";back.type="button";back.className="back";back.textContent="Back";next.type="button";next.textContent="Next";pr.className="progress";
sb.parentNode.insertBefore(nav,sb);nav.appendChild(back);nav.appendChild(next);nav.appendChild(sb);f.insertBefore(pr,st[0]);
var cur=0,met={1:true};
function live(i){return[].some.call(st[i].querySelectorAll("label,fieldset"),function(el){var r=el.closest("[data-show]");return!r||!r.hidden})}
function list(){var o=[];st.forEach(function(x,i){if(live(i))o.push(i)});return o}
function go(i){cur=i;st.forEach(function(x,j){seen(x,j===i)});var l=list(),p=l.indexOf(i),last=p===l.length-1;
seen(back,p>0);seen(next,!last);seen(sb,last);pr.textContent="Step "+(p+1)+" of "+l.length;
var n=+st[i].getAttribute("data-step");if(n>1&&!met[n]){met[n]=true;send("step",n)}}
function move(by){var l=list(),p=l.indexOf(cur);if(by>0){clear(f);var miss=check(st[cur]);if(miss){if(miss.focus)miss.focus();return}}
var to=l[p+by];if(to===undefined)return;go(to);var first=st[to].querySelector("input:not([type=hidden]):not(:disabled),select:not(:disabled),textarea:not(:disabled)");if(first)first.focus()}
back.addEventListener("click",function(){move(-1)});next.addEventListener("click",function(){move(1)});go(0);
return{last:function(){var l=list();return cur===l[l.length-1]},next:function(){move(1)},
sync:function(){var l=list();go(l.indexOf(cur)<0?l[0]:cur)},show:function(el){var x=el.closest(".step");if(x)go(st.indexOf(x))},
reset:function(){met={1:true};go(list()[0])}}}
forms.forEach(function(f){
f.querySelectorAll("input[type=hidden][data-q]").forEach(function(h){var k=h.getAttribute("data-q"),v=q.get(k);if(!v&&touch&&MAP[k])v=touch[MAP[k]];if(v)h.value=String(v).slice(0,200)});
f.addEventListener("focusin",function(){if(!started&&f.hasAttribute("data-form")){started=true;send("start")}});
rules(f);var sp=stepper(f);function changed(){rules(f);if(sp)sp.sync()}
f.addEventListener("input",changed);f.addEventListener("change",changed);
f.addEventListener("submit",function(e){
e.preventDefault();if(sp&&!sp.last()){sp.next();return}
clear(f);var miss=check(f);if(miss){if(sp)sp.show(miss);if(miss.focus)miss.focus();return}
var d={};new FormData(f).forEach(function(v,k){if(typeof v!=="string")return;d[k]=d[k]!==undefined&&k!=="cf-turnstile-response"?d[k]+", "+v:v});
var b=f.querySelector("button[type=submit]"),out=f.querySelector(".sent");if(b)b.disabled=true;
function say(t){if(out){out.hidden=false;out.textContent=t}}
fetch(base+"${FORM_PATH}",{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({page:page,form:f.getAttribute("data-form"),split:split,formSplit:f.getAttribute("data-fsplit"),arm:f.getAttribute("data-arm"),view:view,fields:d,touch:touch})})
.then(function(r){return r.json().then(function(j){if(!r.ok){var er=new Error(j.error||"");er.fields=j.errors;throw er}return j})})
.then(function(){var go=f.getAttribute("data-redirect");if(go){try{top.location.href=go}catch(x){location.href=go}return}
say(f.getAttribute("data-thanks")||"Thanks. We got it.");var bk=f.getAttribute("data-booking");
if(bk&&!f.querySelector(".next")){var u=new URL(bk,location.href);if(d.name)u.searchParams.set("name",d.name);if(d.email)u.searchParams.set("email",d.email);
var a=document.createElement("a");a.className="btn next";a.href=u.href;a.target="_top";a.setAttribute("data-book","");a.textContent=f.getAttribute("data-booking-label")||"Pick a time";out.after(a)}
f.reset();f.querySelectorAll("input[type=hidden][data-q]").forEach(function(h){h.value=h.defaultValue});rules(f);if(sp)sp.reset()})
.catch(function(err){var at=null;if(err.fields)Object.keys(err.fields).forEach(function(k){var el=f.querySelector("[name='"+k.replace(/[^a-z0-9_]/g,"")+"']");if(el){bad(el,err.fields[k]);if(!at)at=el}});if(sp&&at)sp.show(at);say(err.message||"That didn't send. Try again.")})
.finally(function(){if(b)b.disabled=false;if(window.turnstile&&TK)try{window.turnstile.reset()}catch(x){}})})})
})();`;

/** The kit with the Worker's Turnstile site key, or none: then forms post with no check. */
export const kitJs = (turnstileSiteKey: string | null | undefined) =>
  KIT_SOURCE.replace(TK, () => JSON.stringify(turnstileSiteKey?.trim() || null));

/** The kit with no Turnstile: local runs and tests. */
export const KIT_JS = kitJs(null);

/** The tag a code page puts in its `<head>`: the kit from Wren's host, naming the page. */
export const kitTag = (page: string, origin: string) =>
  `<script src="${origin}${KIT_PATH}" data-page="${page}" defer></script>`;

/** A hosted form on someone else's page: a frame, or the kit's tag that draws one. */
export function embedSnippets(o: { origin: string; slug: string; title: string }) {
  const src = `${o.origin}${FORM_PAGE_PATH}${o.slug}?embed=1`;
  const t = o.title.replace(/[&"<>]/g, "");
  return {
    iframe: `<iframe src="${src}" title="${t}" style="width:100%;border:0;min-height:640px" loading="lazy"></iframe>`,
    script: `<script src="${o.origin}${KIT_PATH}" data-embed="${o.slug}" data-title="${t}" defer></script>`,
    url: `${o.origin}${FORM_PAGE_PATH}${o.slug}`,
  };
}
