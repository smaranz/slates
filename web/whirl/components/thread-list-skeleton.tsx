import { Skeleton } from "@whirl/components/ui/skeleton";
import type { ThreadListSnapshot } from "@whirl/lib/thread-cache";

const MAX_BOOT_ROWS = 24;

/* Pre-hydration twin of the cached thread rows. Server HTML can't read
   localStorage, so until React hydrates the sidebar would sit empty (or
   behind bones) — this script (same trick as the theme/sidebar boot
   scripts in the layout) draws the snapshot's REAL rows during HTML
   parsing: actual titles, actual group labels, actual folder names, in
   the same classes the live rows wear. Once React resolves the snapshot
   (pre-paint), identical real rows replace these wholesale.

   Cached text goes through textContent only — never innerHTML — so
   nothing user-controlled is parsed as markup. The two inline SVGs are
   static icon strings (tabler chevron-right + folder-filled). */
const BOOT_SCRIPT = `(function(){try{
var el=document.currentScript&&document.currentScript.parentElement;if(!el)return;
var snap=null;
try{var u=localStorage.getItem('thread-list:last-user');var raw=u&&localStorage.getItem('thread-list:'+u);snap=raw?JSON.parse(raw):null}catch(e){}
var make=function(cls){var d=document.createElement('div');d.className=cls;d.style.animation='none';return d};
if(snap&&((snap.threads&&snap.threads.length)||(snap.folders&&snap.folders.length))){
var CHEV='<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6l-6 6"/></svg>';
var FOLD='<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3a1 1 0 0 1 .608 .206l.1 .087l2.706 2.707h6.586a3 3 0 0 1 2.995 2.824l.005 .176v8a3 3 0 0 1 -2.824 2.995l-.176 .005h-14a3 3 0 0 1 -2.995 -2.824l-.005 -.176v-11a3 3 0 0 1 2.824 -2.995l.176 -.005h4z"/></svg>';
var fids={};(snap.folders||[]).forEach(function(f){fids[f.id]=1});
if(snap.folders&&snap.folders.length){
var fwrap=make('flex flex-col gap-0.5');
snap.folders.forEach(function(f){
var row=make('flex h-8 shrink-0 items-center gap-1.5 pr-8 pl-1.5 text-[13.5px]/4 font-medium text-foreground-soft');
var icons=document.createElement('span');
icons.style.cssText='display:inline-flex;align-items:center;gap:6px;flex-shrink:0';
icons.innerHTML=CHEV+FOLD;
var name=document.createElement('span');
name.className='min-w-0 flex-1 truncate text-left';
name.textContent=String(f.name==null?'':f.name);
row.appendChild(icons);row.appendChild(name);fwrap.appendChild(row);
});
el.appendChild(fwrap);
}
var day=864e5,t0=new Date();t0.setHours(0,0,0,0);
var label=function(t){if(t.pinnedAt!=null)return 'Pinned';var d1=new Date(t.updatedAt);d1.setHours(0,0,0,0);var d=Math.round((t0-d1)/day);return d<=0?'Today':d===1?'Yesterday':d<=7?'Previous 7 days':d<=30?'Previous 30 days':'Older'};
var loose=(snap.threads||[]).filter(function(t){return !(t.folderId&&fids[t.folderId])}).slice(0,${MAX_BOOT_ROWS});
var cur=null,list=null;
loose.forEach(function(t){var l=label(t);
if(l!==cur){cur=l;
var sec=document.createElement('section');sec.style.animation='none';
var head=make('flex h-5 items-center px-2.5 text-[10.5px]/4 font-medium text-muted-foreground/55');
head.textContent=l;
list=make('flex flex-col gap-0.5');
sec.appendChild(head);sec.appendChild(list);el.appendChild(sec);
}
var row=make('flex h-8 shrink-0 items-center pr-8 pl-2.5 text-[13.5px]/4 font-medium text-foreground-soft');
var title=document.createElement('span');
title.className='min-w-0 flex-1 truncate text-left';
title.textContent=String(t.title==null?'':t.title);
row.appendChild(title);list.appendChild(row);
});
}else{
var bone=function(c,w,o){var d=document.createElement('div');d.className='rounded-md bg-muted '+c;if(w)d.style.width=w;if(o)d.style.opacity=o;return d};
var head=make('flex h-5 items-center px-2.5');head.style.animation='';
head.appendChild(bone('h-3','56px'));el.appendChild(head);
for(var i=0;i<5;i++){var r=document.createElement('div');r.className='flex h-8 shrink-0 items-center px-2.5';
r.appendChild(bone('h-3.5',(72-i*9)+'%',String(1-i*0.15)));el.appendChild(r)}
}
}catch(e){}})();`;

/* Static bones — the t-skel layer pulses everything as one, so the
   Skeleton primitive's own animate-pulse is switched off (same trick as
   the user button's skeleton). */
export function ThreadListSkeleton({
  snapshot,
}: {
  snapshot: ThreadListSnapshot | null;
}) {
  if (!snapshot) {
    /* SSR + the instant before React resolves the cache — the boot script
       paints the cached rows (or generic bones when nothing is cached).
       Once the snapshot resolves, real React rows replace this node. */
    return (
      <div
        className="flex h-full flex-col gap-2 overflow-hidden px-3"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{
          __html: `<script>${BOOT_SCRIPT}</script>`,
        }}
      />
    );
  }

  /* Resolved but nothing cached (a genuinely first visit): a plausible
     generic silhouette that pulses until live data lands. */
  return (
    <div className="flex h-full flex-col gap-1 overflow-hidden px-3 pt-1">
      <Skeleton className="mb-1 ml-2.5 h-3 w-14 animate-none" />
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex h-8 shrink-0 items-center px-2.5">
          <Skeleton
            className="h-3.5 animate-none"
            style={{ width: `${72 - index * 9}%`, opacity: 1 - index * 0.15 }}
          />
        </div>
      ))}
    </div>
  );
}
