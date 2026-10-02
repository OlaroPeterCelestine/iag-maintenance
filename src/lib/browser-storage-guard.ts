/**
 * Browser storage lockdown — Postgres is the only source of truth.
 *
 * localStorage is sealed shut: it is wiped on boot and every later write is
 * dropped, so no business record, preference or credential can survive on the
 * device. sessionStorage stays usable only for the short list of tab-scoped
 * auth/boot flags below; any other `financeiag-*` key is rejected.
 *
 * Installed as an inline <head> script so it is in place before application
 * code (or a third-party bundle) gets a chance to write anything.
 */

/**
 * Tab-scoped keys the app is allowed to keep in sessionStorage. Cleared when
 * the tab closes; no business rows. Needed so a hard refresh can paint the
 * shell from the tab session while /api/auth/me restores over the httpOnly cookie.
 */
export const SESSION_STORAGE_ALLOWLIST = [
  // Auth bridge (see src/lib/auth.ts + src/lib/db/sync.ts restoreAuthSessionFromDatabase)
  "financeiag-session",
  "financeiag-keep-signed-in",
  "financeiag-just-logged-out",
  // Boot / recovery flags
  "financeiag-chunk-recovery",
  "financeiag-db-hydrated-v1",
  "financeiag-skip-hydrate-once",
  "financeiag-boot-reload-v1",
  // PWA banner dismissals (tab-scoped by design)
  "financeiag-ios-install-dismissed",
  "financeiag-push-enable-dismissed",
] as const;

const APP_KEY_PREFIX = "financeiag-";

/**
 * Application writes are rejected in both environments. Production additionally
 * seals localStorage outright, since nothing legitimate writes there once the
 * app's own keys are gone; development leaves other keys alone so the Next dev
 * overlay keeps working. Blocked writes are silent in production and warn in
 * development, where the console is still live — a swallowed write would
 * otherwise look like a mysterious data-loss bug.
 */
export function browserStorageGuardScript(dev: boolean): string {
  return `(function(){try{
if(window.__IAG_STORAGE_GUARD__)return;
window.__IAG_STORAGE_GUARD__=true;
var DEV=${dev ? "true" : "false"};
var SEAL=!DEV;
var PREFIX=${JSON.stringify(APP_KEY_PREFIX)};
var ALLOW=${JSON.stringify(SESSION_STORAGE_ALLOWLIST)};
function blocked(store,key){
if(!DEV)return;
try{console.warn('[storage-guard] blocked '+store+' write "'+key+'" — persist via the API instead.');}catch(e){}
}
var ls=null;try{ls=window.localStorage;}catch(e){}
if(ls){
try{
if(SEAL){ls.clear();}
else{
var gone=[];
for(var g=0;g<ls.length;g+=1){var lk=ls.key(g);if(lk&&String(lk).indexOf(PREFIX)===0)gone.push(lk);}
for(var h=0;h<gone.length;h+=1)ls.removeItem(gone[h]);
}
}catch(e){}
}
var sealed={
get length(){return SEAL||!ls?0:ls.length;},
key:function(i){return SEAL||!ls?null:ls.key(i);},
getItem:function(k){return SEAL||!ls?null:ls.getItem(k);},
setItem:function(k,v){
if(SEAL||!ls||String(k).indexOf(PREFIX)===0){blocked('localStorage',k);return;}
ls.setItem(k,v);
},
removeItem:function(k){if(!SEAL&&ls)ls.removeItem(k);},
clear:function(){if(!SEAL&&ls)ls.clear();}
};
try{Object.defineProperty(window,'localStorage',{configurable:false,get:function(){return sealed;},set:function(){}});}catch(e){}
var ss=null;try{ss=window.sessionStorage;}catch(e){}
if(ss){
function permitted(k){return String(k).indexOf(PREFIX)!==0||ALLOW.indexOf(String(k))>=0;}
try{
var stale=[];
for(var i=0;i<ss.length;i+=1){var k=ss.key(i);if(k&&!permitted(k))stale.push(k);}
for(var j=0;j<stale.length;j+=1)ss.removeItem(stale[j]);
}catch(e){}
var guarded={
get length(){return ss.length;},
key:function(i){return ss.key(i);},
getItem:function(k){return ss.getItem(k);},
setItem:function(k,v){if(!permitted(k)){blocked('sessionStorage',k);return;}ss.setItem(k,v);},
removeItem:function(k){ss.removeItem(k);},
clear:function(){ss.clear();}
};
try{Object.defineProperty(window,'sessionStorage',{configurable:false,get:function(){return guarded;},set:function(){}});}catch(e){}
}
}catch(e){}})();`;
}
