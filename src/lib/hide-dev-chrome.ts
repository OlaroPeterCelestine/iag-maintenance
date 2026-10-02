/**
 * Strip Next.js / Vercel developer chrome from the live ERP.
 * Operators must not see the N badge, the red error overlay, or the
 * Vercel toolbar.
 */
export const HIDE_DEV_CHROME_SCRIPT = `(function(){try{
if(window.__IAG_HIDE_DEV_CHROME__)return;
window.__IAG_HIDE_DEV_CHROME__=true;
function hide(el){
if(!el||!el.parentNode)return;
try{el.remove();}catch(e){try{el.style.display='none';}catch(e2){}}
}
function sweep(){
var nodes=document.querySelectorAll(
'nextjs-portal,#nextjs-portal,[data-nextjs-toast],[data-nextjs-dialog],[data-nextjs-dialog-overlay],vercel-live-feedback,#vercel-live-feedback,#vercel-toolbar,[data-vercel-toolbar]'
);
for(var i=0;i<nodes.length;i++)hide(nodes[i]);
}
sweep();
if(typeof MutationObserver==='undefined')return;
var obs=new MutationObserver(sweep);
obs.observe(document.documentElement,{childList:true,subtree:true});
}catch(e){}})();`;
