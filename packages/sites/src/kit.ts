/**
 * The kit (designs/2026-10-07-sites.md, "The kit"): one script every page we run carries, data
 * pages and code pages alike. The Worker serves it at `/o/__kit.js`. It reads `data-page` off its
 * own tag and posts to the host it was loaded from:
 *
 * - a `view` on load, with the utm and referrer the visit arrived on (kept for the tab's session,
 *   so later events and the form carry the first touch);
 * - `cta` on a `[data-cta]` click, `book` on a `[data-book]` click;
 * - every `form[data-wren-form]`: its fields as JSON to `/o/__form`, the answer shown in its
 *   `.sent` line, else `data-thanks`.
 *
 * No cookie and no visitor id: views, not visitors. Bodies go as text/plain, so another origin's
 * page (a code page on Pages) posts with no preflight.
 */

export const KIT_PATH = "/o/__kit.js";
export const TRACK_PATH = "/o/__t";
export const FORM_PATH = "/o/__form";
export const PREVIEW_PATH = "/o/__preview/";

export const KIT_JS = `(function(){
var s=document.currentScript;if(!s)return;
var page=s.getAttribute("data-page");if(!page)return;
var base=new URL(s.src,location.href).origin;
var K="wren_touch",q=new URLSearchParams(location.search),touch=null;
try{touch=JSON.parse(sessionStorage.getItem(K)||"null")}catch(e){}
var ref="";try{if(document.referrer&&new URL(document.referrer).host!==location.host)ref=document.referrer.slice(0,200)}catch(e){}
var now={source:q.get("utm_source"),medium:q.get("utm_medium"),campaign:q.get("utm_campaign"),content:q.get("utm_content"),ref:ref||null};
if(!touch||now.source||now.medium){touch=now;try{sessionStorage.setItem(K,JSON.stringify(touch))}catch(e){}}
var view=crypto.randomUUID?crypto.randomUUID():String(Math.random()).slice(2);
function send(name){var b=JSON.stringify({page:page,view:view,name:name,touch:touch,w:innerWidth});
if(navigator.sendBeacon&&navigator.sendBeacon(base+"${TRACK_PATH}",new Blob([b],{type:"text/plain"})))return;
fetch(base+"${TRACK_PATH}",{method:"POST",body:b,keepalive:true,headers:{"content-type":"text/plain"}}).catch(function(){})}
send("view");
document.addEventListener("click",function(e){var t=e.target,a=t&&t.closest&&t.closest("[data-cta],[data-book]");if(a)send(a.hasAttribute("data-book")?"book":"cta")},true);
document.querySelectorAll("form[data-wren-form]").forEach(function(f){f.addEventListener("submit",function(e){
e.preventDefault();var d={};new FormData(f).forEach(function(v,k){if(typeof v==="string")d[k]=v});
var b=f.querySelector("button[type=submit]"),out=f.querySelector(".sent");if(b)b.disabled=true;
function say(t){if(out){out.hidden=false;out.textContent=t}}
fetch(base+"${FORM_PATH}",{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify({page:page,view:view,fields:d,touch:touch})})
.then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"");return j})})
.then(function(){say(f.getAttribute("data-thanks")||"Thanks. We got it.");f.reset()})
.catch(function(err){say(err.message||"That didn't send. Try again.")})
.finally(function(){if(b)b.disabled=false})})})
})();`;

/** The tag a code page puts in its `<head>`: the kit from Wren's host, naming the page. */
export const kitTag = (page: string, origin: string) =>
  `<script src="${origin}${KIT_PATH}" data-page="${page}" defer></script>`;
