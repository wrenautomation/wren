/**
 * The kit (designs/2026-10-07-sites.md, "The kit"; forms in designs/2026-10-07-forms-and-pay.md):
 * one script every page and hosted form we run carries, data pages and code pages alike. The
 * Worker serves it at `/o/__kit.js`. It reads its own tag and posts to the host it came from:
 *
 * - `data-page` (a page) or `data-form` (a hosted form): a `view` on load with the utm and
 *   referrer the visit arrived on (kept for the tab's session, so later events and the form carry
 *   the first touch); `cta` on a `[data-cta]` click, `book` on a `[data-book]` click; `start` the
 *   first time someone touches a hosted form's field.
 * - every `form[data-wren-form]`: hidden fields filled from the link, checked in the browser,
 *   Turnstile added when the Worker has a site key, the fields sent as JSON to `/o/__form`, then
 *   its thanks, its redirect, or its booking step.
 * - `data-embed="<slug>"`: the hosted form in a frame right after the tag, sized to fit.
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
var page=s.getAttribute("data-page"),first=document.querySelector("form[data-form]");
var form=s.getAttribute("data-form")||(first&&first.getAttribute("data-form"))||null;
if(!page&&!form)return;
var K="wren_touch",touch=null;
try{touch=JSON.parse(sessionStorage.getItem(K)||"null")}catch(e){}
var ref="";try{if(document.referrer&&new URL(document.referrer).host!==location.host)ref=document.referrer.slice(0,200)}catch(e){}
var now={source:q.get("utm_source"),medium:q.get("utm_medium"),campaign:q.get("utm_campaign"),content:q.get("utm_content"),ref:q.get("ref")||ref||null};
if(!touch||now.source||now.medium){touch=now;try{sessionStorage.setItem(K,JSON.stringify(touch))}catch(e){}}
var view=crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2);
function send(name){var b=JSON.stringify({page:page,form:form,view:view,name:name,touch:touch,w:innerWidth});
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
f.querySelectorAll("input[required],select[required],textarea[required]").forEach(function(el){
if(el.type==="checkbox"){if(!el.checked)no(el,"Tick the box to go on.")}else if(!el.value.trim())no(el,"Fill this in.");
else if(el.validity&&!el.validity.valid)no(el,el.type==="email"?"That email doesn't look right.":"Check this one.")});
f.querySelectorAll("fieldset[data-required]").forEach(function(fs){if(!fs.querySelector("input:checked"))no(fs.querySelector("input")||fs,"Pick at least one.")});
return out}
forms.forEach(function(f){
f.querySelectorAll("input[type=hidden][data-q]").forEach(function(h){var k=h.getAttribute("data-q"),v=q.get(k);if(!v&&touch&&MAP[k])v=touch[MAP[k]];if(v)h.value=String(v).slice(0,200)});
f.addEventListener("focusin",function(){if(!started&&f.hasAttribute("data-form")){started=true;send("start")}});
f.addEventListener("submit",function(e){
e.preventDefault();clear(f);var miss=check(f);if(miss){if(miss.focus)miss.focus();return}
var d={};new FormData(f).forEach(function(v,k){if(typeof v!=="string")return;d[k]=d[k]!==undefined&&k!=="cf-turnstile-response"?d[k]+", "+v:v});
var b=f.querySelector("button[type=submit]"),out=f.querySelector(".sent");if(b)b.disabled=true;
function say(t){if(out){out.hidden=false;out.textContent=t}}
fetch(base+"${FORM_PATH}",{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({page:page,form:f.getAttribute("data-form"),view:view,fields:d,touch:touch})})
.then(function(r){return r.json().then(function(j){if(!r.ok){var er=new Error(j.error||"");er.fields=j.errors;throw er}return j})})
.then(function(){var go=f.getAttribute("data-redirect");if(go){try{top.location.href=go}catch(x){location.href=go}return}
say(f.getAttribute("data-thanks")||"Thanks. We got it.");var bk=f.getAttribute("data-booking");
if(bk&&!f.querySelector(".next")){var u=new URL(bk,location.href);if(d.name)u.searchParams.set("name",d.name);if(d.email)u.searchParams.set("email",d.email);
var a=document.createElement("a");a.className="btn next";a.href=u.href;a.target="_top";a.setAttribute("data-book","");a.textContent=f.getAttribute("data-booking-label")||"Pick a time";out.after(a)}
f.reset();f.querySelectorAll("input[type=hidden][data-q]").forEach(function(h){h.value=h.defaultValue})})
.catch(function(err){if(err.fields)Object.keys(err.fields).forEach(function(k){var el=f.querySelector("[name='"+k.replace(/[^a-z0-9_]/g,"")+"']");if(el)bad(el,err.fields[k])});say(err.message||"That didn't send. Try again.")})
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
