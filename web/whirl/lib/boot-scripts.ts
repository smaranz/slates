/* Inline <head> scripts that run during HTML parsing, before React boots.
 *
 * Every one of them exists to stop a flash: the server's HTML is blind to
 * the reader's stored preferences, so without these the first painted
 * frame is the wrong theme, the wrong tint, the wrong sidebar width, and
 * then it snaps. They read localStorage and paint the answer onto <html>
 * before the browser draws anything.
 *
 * All three are fixed, hand-written strings — no props, no request data,
 * no interpolation. Nothing reader-supplied is ever concatenated into
 * them, which is the whole reason it's safe to hand them to a script tag.
 * The *values* they read at runtime are treated as hostile and validated
 * on the spot (a character class on the accent, isFinite on the tint
 * numbers, a clamp on the width) — localStorage is reader-writable, and a
 * stale or hand-edited entry must never become an attribute or a style.
 *
 * Keep them tiny and dependency-free: they block parsing.
 */

/** Theme class + accent attribute. Mirrors lib/theme.ts and app/accents.css. */
export const THEME_BOOT_SCRIPT =
  "try{var t=localStorage.getItem('theme');if(!t||t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark');var a=localStorage.getItem('accent');if(a&&a!=='graphite'&&/^[a-z]+$/.test(a))document.documentElement.setAttribute('data-accent',a)}catch(e){}";

/** Canvas tint tokens. The math mirrors tintTokens in lib/tint.ts — keep them in step. */
export const TINT_BOOT_SCRIPT =
  "try{var r=localStorage.getItem('canvas-tint');if(r){var t=JSON.parse(r);if(t&&t.enabled===true&&isFinite(t.hue)&&isFinite(t.strength)){var d=document.documentElement,h=Math.round(((t.hue%360)+360)%360),s=Math.min(1,Math.max(0,t.strength)),c=0.02+0.06*s,k=0.012+0.038*s,o=function(l,x){return'oklch('+l+' '+x.toFixed(4)+' '+h+')'},p=function(n,v){d.style.setProperty(n,v)};p('--tint-bg-l',o(0.964,c));p('--tint-well-l',o(0.964,c*0.55));p('--tint-surface-l',o(0.99,c*0.35));p('--tint-bg-d',o(0.244,k));p('--tint-surface-d',o(0.209,k*0.6));p('--tint-well-d',o(0.256,k*0.7));p('--tint-popover-d',o(0.269,k*0.6));d.setAttribute('data-tinted','')}}}catch(e){}";

/** Sidebar width / collapsed rail. Numbers mirror lib/sidebar.ts. */
export const SIDEBAR_BOOT_SCRIPT =
  "try{var d=document.documentElement,c=localStorage.getItem('sidebar-collapsed')==='1',w=Math.min(440,Math.max(220,+localStorage.getItem('sidebar-width')||256));d.style.setProperty('--sidebar-width',(c?64:w)+'px');if(c)d.setAttribute('data-sidebar-collapsed','')}catch(e){}";
