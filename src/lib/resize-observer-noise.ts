/**
 * "ResizeObserver loop completed with undelivered notifications" (and the older
 * "ResizeObserver loop limit exceeded") is a browser notice rather than a
 * failure: a resize callback changed layout enough to need another pass, so the
 * observer spent its loop budget and delivers the rest on the next frame.
 * Nothing is lost and no app code is broken.
 *
 * The browser still raises it as a global error event, where the dev overlay
 * renders a red error and the crash reporter would file a fatal crash. Charts
 * and resizable panels trigger it during ordinary layout, so it is recognised
 * and dropped instead of reported.
 */

const NOISE_PATTERN =
  /resizeobserver loop (limit exceeded|completed with undelivered notifications)/i;

export function isResizeObserverNoise(value: unknown): boolean {
  const message =
    value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (!message) return false;
  return NOISE_PATTERN.test(message);
}

/**
 * Runs from <head> because error listeners on window fire in registration
 * order: suppressing this from a React effect would install the listener after
 * the framework's own, which has already rendered the overlay by then.
 */
export const RESIZE_OBSERVER_NOISE_SCRIPT = `(function(){try{
if(window.__IAG_RO_NOISE__)return;
window.__IAG_RO_NOISE__=true;
var RE=${NOISE_PATTERN.toString()};
window.addEventListener('error',function(e){
if(!e||!RE.test(String(e.message||'')))return;
e.stopImmediatePropagation();
e.preventDefault();
},true);
}catch(e){}})();`;
