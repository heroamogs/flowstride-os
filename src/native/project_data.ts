import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import type { FlowstrideConfig } from '../types';
import { projectPath } from '../utils/projectPaths';
import { dataSnapshot } from './paths';
import { isSensitiveField } from '../security/sensitiveFields';

export const DATA_LIMIT = 1024 * 1024;
export const variableName = z.string().regex(/^[A-Za-z_]\w{0,127}$/).refine(value => !['__proto__','prototype','constructor','global'].includes(value), 'Choose a safe local variable name.');
export const dataFormat = z.enum(['json','csv','text']);
export const loadDataSchema = z.object({ file:z.string().min(1).max(4000), as:variableName, format:dataFormat.optional() }).strict();
export const casesSchema = z.object({ file:z.string().min(1).max(4000), as:variableName.default('case'), format:z.enum(['json','csv']).optional() }).strict();

/** Open a pinned regular-file descriptor, then bound the read before allocating. */
export function readBoundedProjectFile(config: Pick<FlowstrideConfig,'projectRoot'>, file: string, maximum = DATA_LIMIT): Buffer {
  const root = config.projectRoot || process.cwd(), absolute = projectPath(root,file);
  let fd: number | undefined;
  try {
    for(const candidate of [absolute,fs.realpathSync(absolute)]){
      const parts=path.relative(fs.realpathSync(root),candidate).split(path.sep);
      if(parts.some(part=>['.git','.flowstride','.ssh','.aws','.npmrc','.netrc'].includes(part)||/^\.env(?:\.|$)/.test(part)))throw new Error('Private runtime state and credential/configuration files are not fixture data.');
    }
    const before = fs.lstatSync(absolute, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n) throw new Error('Expected one regular project file, not a directory, device, symbolic link or hard link.');
    const changed = () => new Error('The project file changed while opening it.');
    const assertPathIdentity = () => {
      projectPath(root, file);
      const current = fs.lstatSync(absolute, { bigint: true });
      if (!current.isFile() || current.nlink !== 1n || current.dev !== before.dev || current.ino !== before.ino) throw changed();
    };
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    fd = fs.openSync(absolute, flags);
    const stat = fs.fstatSync(fd, { bigint: true });
    if (!stat.isFile() || stat.nlink !== 1n || stat.ino !== before.ino) throw changed();
    assertPathIdentity();
    if (stat.dev !== before.dev) {
      if (process.platform !== 'win32') throw changed();
      // Windows can report different volume IDs for path and descriptor stats.
      // Verify the original against a second descriptor opened at the checked path.
      const reference = fs.openSync(absolute, flags);
      try {
        const verified = fs.fstatSync(reference, { bigint: true });
        if (!verified.isFile() || verified.nlink !== 1n || verified.dev !== stat.dev || verified.ino !== stat.ino) throw changed();
      } finally { fs.closeSync(reference); }
      assertPathIdentity();
    }
    if (stat.size > BigInt(maximum)) throw new Error(`File exceeds the ${maximum}-byte limit.`);
    const size = Number(stat.size), bytes = Buffer.alloc(size + 1);
    let count = 0;
    while (count < bytes.length) { const n = fs.readSync(fd, bytes, count, bytes.length - count, null); if (!n) break; count += n; }
    const after = fs.fstatSync(fd, { bigint: true });
    if (count !== size || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs || after.nlink !== 1n) {
      throw new Error('The project file grew or changed while reading it.');
    }
    assertPathIdentity();
    return bytes.subarray(0, count);
  } catch (error) { throw new Error(`Cannot read project file ${JSON.stringify(file)}: ${error instanceof Error ? error.message : String(error)}`); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function validateKeys(value: any, depth = 0): void {
  if (depth > 32) throw new Error('Data exceeds the 32-level nesting limit.');
  if (!value || typeof value !== 'object') return;
  for (const [key,item] of Object.entries(value)) {
    if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Data contains a forbidden prototype-related field.');
    validateKeys(item,depth+1);
  }
}

/** RFC-style quoted fields, including embedded commas/newlines and doubled quotes. No evaluation/coercion. */
export function parseCSV(text: string): Record<string,string>[] {
  const records: { values:string[]; line:number }[] = [];
  let values:string[] = [], field = '', quoted = false, afterQuote = false, line = 1, startLine = 1, touched = false;
  const finishField = () => { values.push(field); if(values.length>1000)throw new Error('CSV exceeds 1000 columns.'); field=''; afterQuote=false; };
  const finishRecord = () => { finishField(); if (touched || values.some(value=>value!=='')) records.push({values,line:startLine}); if(records.length>1001)throw new Error('CSV exceeds 1000 data rows.'); values=[]; touched=false; startLine=line+1; };
  for (let index=0;index<text.length;index++) {
    const character=text[index];
    if (quoted) {
      if (character==='"') { if(text[index+1]==='"'){field+='"';index++;}else{quoted=false;afterQuote=true;} }
      else { field+=character; if(character==='\n')line++; }
      continue;
    }
    if (afterQuote && ![',','\r','\n'].includes(character)) throw new Error(`CSV line ${line}: unexpected character after a closing quote.`);
    if (character==='"') { if(field.length)throw new Error(`CSV line ${line}: a quoted field must start with a quote.`);quoted=true;touched=true; }
    else if(character===','){finishField();touched=true;}
    else if(character==='\r'||character==='\n'){if(character==='\r'&&text[index+1]==='\n')index++;finishRecord();line++;startLine=line;}
    else {field+=character;touched=true;}
    if (values.length > 1000 || records.length > 1001) throw new Error('CSV exceeds the row/column limit.');
  }
  if(quoted)throw new Error(`CSV record starting on line ${startLine}: unterminated quoted field.`);
  if(field.length||values.length||touched||afterQuote)finishRecord();
  if(!records.length)throw new Error('CSV needs a header row.');
  const header=records.shift()!.values;
  if(header.some(key=>!key.trim()||['__proto__','prototype','constructor'].includes(key))||new Set(header).size!==header.length)throw new Error('CSV headers must be nonempty, unique and free of prototype-related names.');
  return records.map(record=>{
    if(record.values.length!==header.length)throw new Error(`CSV line ${record.line}: expected ${header.length} columns, found ${record.values.length}.`);
    return Object.fromEntries(header.map((key,index)=>[key,record.values[index]]));
  });
}

export function loadProjectData(config: Pick<FlowstrideConfig,'projectRoot'>, file: string, requested?: z.infer<typeof dataFormat>) {
  const bytes=readBoundedProjectFile(config,file), format=requested || (path.extname(file).toLowerCase()==='.json'?'json':path.extname(file).toLowerCase()==='.csv'?'csv':'text');
  let text:string;
  try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''); }
  catch { throw new Error(`Data file ${JSON.stringify(file)} is not valid UTF-8.`); }
  let value:unknown;
  try { value=format==='text'?text:format==='csv'?parseCSV(text):JSON.parse(text); validateKeys(value);value=dataSnapshot(value); }
  catch(error){
    // JSON parser messages may include credential-bearing source excerpts.
    if(error instanceof SyntaxError)throw new Error(`Invalid JSON in data file ${JSON.stringify(file)}. Check its quotes, commas and nesting; source values are withheld.`);
    throw new Error(`Invalid ${format.toUpperCase()} data in ${JSON.stringify(file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {value,format,file,sha256:createHash('sha256').update(bytes).digest('hex')};
}

export function dataSecrets(value: unknown, sensitive = false): string[] {
  const result:string[]=[];
  const visit=(item:any, secret:boolean)=>{
    if(typeof item==='string'||typeof item==='number'){if(secret&&String(item))result.push(String(item));return;}
    if(item&&typeof item==='object')for(const[key,child]of Object.entries(item))visit(child,secret||isSensitiveField(key));
  };
  visit(value,sensitive);return result;
}
