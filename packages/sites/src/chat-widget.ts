/**
 * The site chat bubble (designs/2026-10-09-site-chat.md), served as `/o/__chat.js`. One tag on any
 * page; it talks to `/o/__chat` on the host it came from. A shadow root keeps the page's styles out
 * and ours in. `data-color` on the tag sets the accent; `data-greeting` the first line. The
 * store behind it is `@wren/content`'s `chat/`.
 */
export const CHAT_SCRIPT_PATH = "/o/__chat.js";
export const CHAT_PATH = "/o/__chat";
/** How often an open bubble checks for replies. */
export const CHAT_POLL_MS = 4000;
/** How long a chat message may run. */
export const CHAT_MAX = 2000;

export function chatJs(): string {
  return `(()=>{
"use strict";
const me=document.currentScript;if(!me||window.__wrenChat)return;window.__wrenChat=1;
const base=new URL(me.src).origin,api=base+${JSON.stringify(CHAT_PATH)};
const color=/^#[0-9a-fA-F]{3,8}$/.test(me.dataset.color||"")?me.dataset.color:"#1b1714";
const greeting=(me.dataset.greeting||"Questions? Ask here and we'll answer.").slice(0,200);
const store="wren-chat:"+base;
let key=null,after=0,open=false,timer=0,busy=false;
try{key=localStorage.getItem(store)}catch(e){}
const host=document.createElement("div");host.style.cssText="position:fixed;right:16px;bottom:16px;z-index:2147483000";
const root=host.attachShadow({mode:"open"});
root.innerHTML=\`<style>
:host{all:initial}*{box-sizing:border-box;font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
.b{width:56px;height:56px;border:0;border-radius:50%;background:\${color};color:#fff;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2);display:grid;place-items:center}
.b svg{width:26px;height:26px}
.p{position:absolute;right:0;bottom:68px;width:340px;max-width:calc(100vw - 32px);height:460px;max-height:calc(100vh - 100px);background:#fff;color:#1b1714;border:1px solid #e5dfd6;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden}
.p[hidden]{display:none}
.h{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #e5dfd6;font-weight:600}
.x{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:#6d665e;padding:4px}
.m{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.l{max-width:85%;padding:8px 11px;border-radius:8px;white-space:pre-wrap;word-wrap:break-word}
.l.you{align-self:flex-end;background:\${color};color:#fff}.l.us{align-self:flex-start;background:#f2ede5}
.g{color:#6d665e;font-size:14px}
form{border-top:1px solid #e5dfd6;padding:10px;display:grid;gap:6px}
input,textarea{width:100%;border:1px solid #e5dfd6;border-radius:6px;padding:8px 10px;background:#fff;color:#1b1714}
textarea{resize:none;height:64px}
.r{display:flex;justify-content:space-between;align-items:center;gap:8px}
.e{color:#b3261e;font-size:13px}
.s{border:0;border-radius:6px;background:\${color};color:#fff;padding:8px 16px;font-weight:600;cursor:pointer}
.s:disabled{opacity:.5;cursor:default}
@media (max-width:480px){.p{position:fixed;inset:auto 8px 80px 8px;width:auto;max-width:none}}
</style>
<div class="p" role="dialog" aria-label="Chat" hidden>
<div class="h"><span>Chat with us</span><button class="x" type="button" aria-label="Close chat">×</button></div>
<div class="m" aria-live="polite"><p class="g"></p></div>
<form><div class="who"><input name="name" autocomplete="name" placeholder="Your name (optional)" maxlength="120">
<input name="contact" autocomplete="email" placeholder="Email or phone, so we can reply if you leave" maxlength="200" style="margin-top:6px"></div>
<textarea name="body" placeholder="Type your message" maxlength="${CHAT_MAX}" aria-label="Message" required></textarea>
<div class="r"><span class="e" role="alert"></span><button class="s" type="submit">Send</button></div></form>
</div>
<button class="b" type="button" aria-label="Open chat" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>\`;
const $=(s)=>root.querySelector(s),panel=$(".p"),list=$(".m"),form=$("form"),err=$(".e"),send=$(".s"),who=$(".who"),btn=$(".b");
$(".g").textContent=greeting;
const add=(lines)=>{for(const l of lines){if(l.id<=after)continue;after=l.id;const d=document.createElement("div");d.className="l "+(l.from==="you"?"you":"us");d.textContent=l.body;list.appendChild(d)}list.scrollTop=list.scrollHeight};
const post=async(body)=>{const r=await fetch(api,{method:"POST",headers:{"content-type":"text/plain"},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||"That didn't send. Try again.");return j};
const poll=async()=>{if(!key||!open||busy)return;try{const j=await post({op:"read",key,after});add(j.lines||[])}catch(e){if(/No such chat/.test(e.message)){key=null;try{localStorage.removeItem(store)}catch(_){}}}};
const show=(on)=>{open=on;panel.hidden=!on;btn.setAttribute("aria-expanded",String(on));who.hidden=!!key;clearInterval(timer);if(on){poll();timer=setInterval(poll,${CHAT_POLL_MS});form.body.focus()}};
btn.addEventListener("click",()=>show(!open));$(".x").addEventListener("click",()=>show(false));
form.body.addEventListener("keydown",(e)=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
form.addEventListener("submit",async(e)=>{e.preventDefault();const body=form.body.value.trim();if(!body||busy)return;busy=true;send.disabled=true;err.textContent="";
try{const j=await post({op:"say",key,body,after,name:key?undefined:form.name.value,contact:key?undefined:form.contact.value,page:location.href});
if(j.key&&j.key!==key){key=j.key;try{localStorage.setItem(store,key)}catch(_){}}who.hidden=true;form.body.value="";add(j.lines||[])}
catch(x){err.textContent=x.message}finally{busy=false;send.disabled=false}});
(document.body||document.documentElement).appendChild(host);
})();`;
}
