import { randomUUID } from 'node:crypto';
import { dataSnapshot } from './paths';

const reference = /(?<![A-Za-z0-9_@])@([A-Za-z_]\w*)((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\["(?:[^"\\]|\\.)*"\])*)/g;
const forbidden = new Set(['__proto__','prototype','constructor']);
function readReference(alias: string, suffix: string, variables: Record<string,unknown>): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(variables,alias);
  if(!descriptor||!('value' in descriptor))throw new Error(`Loaded data variable @${alias} is no longer available.`);
  let value=descriptor.value, rest=suffix, count=0;
  while(rest){
    if(++count>32)throw new Error('A loaded-data reference exceeds 32 path segments.');
    const dot=/^\.([A-Za-z_$][\w$]*)/.exec(rest),index=/^\[(\d+)\]/.exec(rest),quoted=/^\[("(?:[^"\\]|\\.)*")\]/.exec(rest);
    const match=dot||index||quoted;if(!match)throw new Error('Invalid loaded-data reference path.');
    const key=quoted?JSON.parse(quoted[1]):match[1];
    if(forbidden.has(key))throw new Error('Loaded-data references cannot access prototype-related fields.');
    const own=value!==null&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key):undefined;
    if(!own||!('value'in own))throw new Error(`Loaded-data reference @${alias}${suffix} has no plain data field ${JSON.stringify(key)}.`);
    value=own.value;rest=rest.slice(match[0].length);
  }
  return dataSnapshot(value);
}

/** Fixture values are opaque data. They cannot introduce env/generator expansion or DSL/JSON code. */
export function interpolateData(text: string, aliases: ReadonlySet<string>, variables: Record<string,unknown>, legacy: (text:string)=>string, typed = false): any {
  if(!aliases.size)return legacy(text);
  const matches:RegExpMatchArray[]=[];
  for(const match of text.matchAll(reference))if(aliases.has(match[1])){matches.push(match);if(matches.length>10000)throw new Error('Loaded-data interpolation exceeds 10000 references.');}
  if(!matches.length)return legacy(text);
  if(text.length>1024*1024)throw new Error('A loaded-data template exceeds 1 MiB.');
  if(typed&&matches.length===1&&matches[0][0]===text)return readReference(matches[0][1],matches[0][2],variables);
  if(/^[\s]*[\[{]/.test(text)){
    let parsed:any;
    try{parsed=JSON.parse(text);}catch{}
    if(parsed!==undefined){
      parsed=dataSnapshot(parsed);
      let budget=0;
      const resolve=(value:any):any=>{
        if(typeof value==='string'){
          const result=interpolateData(value,aliases,variables,legacy,true);budget+=JSON.stringify(result).length;
          if(budget>1024*1024)throw new Error('Expanded loaded-data JSON exceeds 1 MiB.');return result;
        }
        if(Array.isArray(value))return value.map(resolve);
        if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[String(interpolateData(key,aliases,variables,legacy)),resolve(item)]));
        return value;
      };
      const result=JSON.stringify(resolve(parsed));if(result.length>1024*1024)throw new Error('Expanded loaded-data JSON exceeds 1 MiB.');return result;
    }
  }
  const values=new Map<string,string>(),cache=new Map<string,string>(),prefix=`FLOW_DATA_${randomUUID().replace(/-/g,'')}_`;
  let size=text.length;
  const masked=text.replace(reference,(full,alias,suffix)=>{
    if(!aliases.has(alias))return full;
    let literal=cache.get(full);
    if(literal===undefined){const value=readReference(alias,suffix,variables);literal=typeof value==='string'?value:JSON.stringify(value);cache.set(full,literal);}
    size+=literal.length-full.length;if(size>1024*1024)throw new Error('Expanded loaded-data template exceeds 1 MiB.');
    const key=prefix+values.size+'Z';values.set(key,literal);return key;
  });
  let result=legacy(masked);
  // One pass: newly inserted strings never become further references or executable templates.
  const pattern=new RegExp(prefix+'\\d+Z','g');
  result=result.replace(pattern,key=>values.get(key)!);return result;
}

export function hasExactDataReference(text: unknown, aliases: ReadonlySet<string>): text is string {
  if(typeof text!=='string')return false;
  const matches=[...text.matchAll(reference)];return matches.length===1&&matches[0][0]===text&&aliases.has(matches[0][1]);
}
