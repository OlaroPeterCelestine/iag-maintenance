/**
 * Send a cold visit to /login before the dashboard shell can paint.
 *
 * The overview lives at `/` inside AppShell, so the first HTML for the site
 * URL is the signed-in chrome (sidebar + page shimmer). A new tab has no
 * sessionStorage, even when the httpOnly cookie is still valid — without this
 * script the visitor sees that shimmer, then a client redirect to sign-in.
 *
 * Runs in <head> so the replace happens before <body> paints. Same-tab refresh
 * keeps `financeiag-session` and is left on the current page.
 *
 * Key must match `SESSION_KEY` in `src/lib/auth.ts`.
 */
const SESSION_STORAGE_KEY = "financeiag-session";

const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/guides"] as const;

export const LOGIN_FIRST_SCRIPT = `(function(){try{
var p=location.pathname||"/";
var publicPrefixes=${JSON.stringify(PUBLIC_PREFIXES)};
for(var i=0;i<publicPrefixes.length;i++){
  var pre=publicPrefixes[i];
  if(p===pre||p.indexOf(pre+"/")===0)return;
}
try{
  var raw=sessionStorage.getItem(${JSON.stringify(SESSION_STORAGE_KEY)});
  if(raw){
    var parsed=JSON.parse(raw);
    if(parsed&&parsed.userId&&parsed.email)return;
  }
}catch(e){}
var next=p+(location.search||"");
if(next.charAt(0)!=="/"||next.indexOf("//")===0)next="/";
location.replace("/login?next="+encodeURIComponent(next));
}catch(e){}})();`;
