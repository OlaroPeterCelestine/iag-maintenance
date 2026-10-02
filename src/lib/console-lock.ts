/**
 * Browser console lockdown.
 *
 * Production browsers must not print application logs: anything a user can read
 * in devtools is also readable by anyone looking over their shoulder or running
 * a hostile extension. `console.error` / `console.warn` are not dropped — they
 * are buffered and shipped to /api/crash so failures land in the database
 * instead of the console.
 *
 * Runs as an inline <head> script so third-party and pre-hydration output is
 * covered too. Methods are installed as non-configurable accessors, so
 * `console.log = …` from any later code is silently ignored rather than
 * throwing.
 */

export const CONSOLE_SINK_GLOBAL = "__IAG_CONSOLE_SINK__";

/** Console entry captured before hydration, drained by the crash reporter. */
export type ConsoleSinkEntry = {
  level: "error" | "warn";
  message: string;
  stack?: string;
  at: number;
};

const SILENCED_METHODS = [
  "log",
  "debug",
  "info",
  "trace",
  "table",
  "dir",
  "dirxml",
  "group",
  "groupCollapsed",
  "groupEnd",
  "time",
  "timeEnd",
  "timeLog",
  "count",
  "countReset",
  "assert",
  "profile",
  "profileEnd",
  "timeStamp",
];

/** Cap the buffer so a render loop screaming errors cannot grow unbounded. */
const MAX_SINK_ENTRIES = 50;

/**
 * Argument formatting deliberately avoids JSON.stringify: logged objects are
 * usually API payloads or user records, and those must not be copied into the
 * crash store. Objects collapse to their type tag; only strings and Errors keep
 * their text.
 */
export const CONSOLE_LOCK_SCRIPT = `(function(){try{
if(window.${CONSOLE_SINK_GLOBAL})return;
var SINK=[];window.${CONSOLE_SINK_GLOBAL}=SINK;
var MAX=${MAX_SINK_ENTRIES};
/* Duck-typed: instanceof misses errors thrown from another realm (iframe/worker). */
function isErr(v){
return !!v&&typeof v==='object'&&typeof v.message==='string'&&typeof v.stack==='string';
}
function describe(v){
try{
if(isErr(v))return (v.name||'Error')+': '+(v.message||'');
var t=typeof v;
if(v===null)return 'null';
if(t==='string')return v;
if(t==='number'||t==='boolean'||t==='undefined')return String(v);
if(t==='function')return '[function]';
return Object.prototype.toString.call(v);
}catch(e){return '[unserializable]';}
}
function record(level,args){
if(SINK.length>=MAX)return;
var parts=[];var stack;
for(var i=0;i<args.length&&i<6;i+=1){
var a=args[i];
if(!stack&&isErr(a))stack=a.stack;
parts.push(describe(a));
}
SINK.push({level:level,message:parts.join(' ').slice(0,500),stack:stack,at:Date.now()});
}
var noop=function(){};
var c=window.console||{};
function lock(name,fn){
try{Object.defineProperty(c,name,{configurable:false,enumerable:true,get:function(){return fn;},set:function(){}});}
catch(e){try{c[name]=fn;}catch(e2){}}
}
lock('error',function(){record('error',arguments);});
lock('warn',function(){record('warn',arguments);});
var m=${JSON.stringify(SILENCED_METHODS)};
for(var i=0;i<m.length;i+=1)lock(m[i],noop);
try{Object.defineProperty(window,'console',{configurable:false,get:function(){return c;},set:function(){}});}catch(e){}
}catch(e){}})();`;

/** Take everything buffered so far, leaving the sink empty. */
export function drainConsoleSink(): ConsoleSinkEntry[] {
  if (typeof window === "undefined") return [];
  const sink = (window as unknown as Record<string, unknown>)[CONSOLE_SINK_GLOBAL];
  if (!Array.isArray(sink) || sink.length === 0) return [];
  return sink.splice(0, sink.length) as ConsoleSinkEntry[];
}

/** True when the lock script installed itself (production browsers only). */
export function isConsoleLocked(): boolean {
  if (typeof window === "undefined") return false;
  return Array.isArray((window as unknown as Record<string, unknown>)[CONSOLE_SINK_GLOBAL]);
}
