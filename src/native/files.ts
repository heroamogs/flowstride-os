import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import type { Locator, ElementHandle, FileChooser } from 'playwright';
import type { WebAdapter } from '../adapters/web/playwright';
import type { FlowstrideConfig } from '../types';
import type { InteractionControl } from './interactions';
import { readableTargetSchema, readableTargetDescription } from './targeting';
import { dataSnapshot } from './paths';
import { positive } from './validation';
import { readBoundedProjectFile } from './project_data';
import { projectPath } from '../utils/projectPaths';
import { ArmedEvent } from './events';

const schema=z.object({target:readableTargetSchema.optional(),selector:z.string().min(1).max(4000).optional(),files:z.array(z.string().min(1).max(4000)).max(100).optional(),directory:z.string().min(1).max(4000).optional(),timeout:positive.optional()}).strict()
  .refine(data=>[data.target,data.selector].filter(value=>value!==undefined).length===1,'Choose exactly one readable target or explicit selector.')
  .refine(data=>[data.files,data.directory].filter(value=>value!==undefined).length===1,'Choose files (an array, or [] to clear) or one project directory.');
const FILE_LIMIT=20*1024*1024,TOTAL_LIMIT=50*1024*1024;
const mime:Record<string,string>={'.txt':'text/plain','.csv':'text/csv','.json':'application/json','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.wav':'audio/wav','.mp3':'audio/mpeg','.mp4':'video/mp4','.webm':'video/webm','.html':'text/html','.zip':'application/zip'};

/** New selection is bounded/project-scoped; the existing flow.upload implementation is untouched. */
export class NativeFiles {
  private pending=new Set<ArmedEvent<FileChooser>>();
  private generation=0;
  private stagingPaths=new Map<string,number>();
  private stagedBytes=0;
  constructor(private web:WebAdapter,private config:FlowstrideConfig,private control?:InteractionControl){}
  async select(input:unknown):Promise<void>{
    const data=schema.parse(dataSnapshot(input)),duration=data.timeout??this.config.timeout??30000,deadline=Date.now()+duration,generation=this.generation;
    const check=()=>{if(generation!==this.generation||this.control?.cancelled())throw new Error('File selection cancelled.');const left=deadline-Date.now();if(left<=0)throw new Error(`File selection timed out after ${duration} ms.`);return left;};
    check();
    const rows:{file:string;relative:string;buffer:Buffer}[]=[];let total=0,staging:string|undefined;
    const add=(file:string,relative=path.basename(file))=>{
      check();if(rows.length>=100)throw new Error('File selection exceeds 100 files.');
      const buffer=readBoundedProjectFile(this.config,file,FILE_LIMIT);total+=buffer.length;if(total>TOTAL_LIMIT)throw new Error('Selected files exceed the 50 MiB total limit.');
      rows.push({file,relative,buffer});
    };
    if(data.directory!==undefined){
      const root=projectPath(this.config.projectRoot||process.cwd(),data.directory),stat=fs.lstatSync(root);
      if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Directory selection requires a regular project directory, not a symbolic link.');
      let entries=0;
      const visit=(directory:string,depth:number)=>{
        check();if(depth>16)throw new Error('Upload directory exceeds 16 levels.');
        const names:fs.Dirent[]=[],handle=fs.opendirSync(directory);
        try{let entry:fs.Dirent|null;while((entry=handle.readSync())){if(++entries>5000)throw new Error('Upload directory exceeds 5000 entries.');names.push(entry);}}finally{handle.closeSync();}
        for(const entry of names.sort((a,b)=>a.name.localeCompare(b.name))){
          const absolute=projectPath(this.config.projectRoot||process.cwd(),path.join(directory,entry.name)),info=fs.lstatSync(absolute);
          if(info.isSymbolicLink())throw new Error('Upload directories cannot contain symbolic links.');
          if(info.isDirectory())visit(absolute,depth+1);
          else if(info.isFile())add(absolute,path.relative(root,absolute));else throw new Error('Upload directories may contain only regular files/directories.');
        }
      };visit(root,0);if(!rows.length)throw new Error('Upload directory contains no regular files.');
    }else{
      const identities=new Set<string>();
      for(const file of data.files!){const absolute=projectPath(this.config.projectRoot||process.cwd(),file);if(identities.has(absolute))throw new Error('Do not select the same file twice.');identities.add(absolute);add(file);}
    }
    const label=data.target===undefined?`selector ${JSON.stringify(data.selector)}`:readableTargetDescription(data.target);
    let locator:Locator;
    for(;;){
      check();
      locator=data.target===undefined?this.web.getScope().locator(data.selector!):await this.web.resolveAssertionTarget(data.target);
      const direct=locator.locator('xpath=self::input[@type="file"]');
      const directCount=await direct.count();
      if(directCount>1)throw new Error(`Ambiguous file input ${label}: ${directCount} matches. Narrow it with a readable qualifier, spatial/container scope or selector.`);
      if(directCount===1){locator=direct;break;}
      const visible=locator.filter({visible:true}),count=await visible.count();
      if(count>1)throw new Error(`Ambiguous upload trigger ${label}: ${count} visible matches. Narrow its readable/spatial target.`);
      if(count===1){locator=visible;break;}
      const wait=Math.min(40,check());if(this.control)await this.control.delay(wait);else await new Promise(resolve=>setTimeout(resolve,wait));
    }
    let chooser:FileChooser|undefined,handle:ElementHandle<HTMLInputElement>|undefined;
    try{
      check();
      const isFileInput=await locator.evaluate(element=>element instanceof HTMLInputElement&&element.type==='file');
      if(!isFileInput){
        if(!rows.length)throw new Error('Clearing selected files requires a direct labelled file input or explicit file-input selector.');
        if(!await locator.isEnabled({timeout:check()}))throw new Error(`Upload trigger ${label} is disabled.`);
        const trigger=await locator.elementHandle({timeout:check()}),owner=await trigger?.ownerFrame();await trigger?.dispose();
        const page=this.web.getPage(),onChooser=(event:FileChooser)=>armed.capture(event),onClose=()=>armed.fail(new Error('Upload page closed before the file chooser arrived.'));
        const armed=new ArmedEvent<FileChooser>(check(),()=>{page.off('filechooser',onChooser);page.off('close',onClose);});
        this.pending.add(armed);page.on('filechooser',onChooser);page.on('close',onClose);
        try{
          await locator.click({timeout:check()});check();chooser=await armed.take();check();
          handle=chooser.element() as ElementHandle<HTMLInputElement>;
          if(await handle.ownerFrame()!==owner)throw new Error('The file chooser belongs to a different iframe than the selected upload trigger.');
        }finally{armed.fail(new Error('File chooser capture finished.'));this.pending.delete(armed);}
      }
      const control=handle||locator;
      const describe=(element:Element)=>({file:element instanceof HTMLInputElement&&element.type==='file',multiple:(element as HTMLInputElement).multiple,directory:element.hasAttribute('webkitdirectory'),disabled:(element as HTMLInputElement).disabled});
      const flags=handle?await handle.evaluate(describe):await locator.evaluate(describe);
      if(!flags.file)throw new Error('The upload target is not a file input.');
      if(flags.disabled)throw new Error('The selected file input is disabled.');
      if(data.directory!==undefined&&!flags.directory)throw new Error('This input does not support directory selection (webkitdirectory).');
      if(data.directory===undefined&&flags.directory&&rows.length)throw new Error('This input selects directories. Supply directory instead of files.');
      if(rows.length>1&&data.directory===undefined&&!flags.multiple)throw new Error(`The input accepts one file, but ${rows.length} were selected. Choose a multiple-file input.`);
      check();
      if(data.directory!==undefined){
        if(this.stagingPaths.size>=100||this.stagedBytes+total>TOTAL_LIMIT)throw new Error('Directory staging exceeds 100 selections or 50 MiB for this execution scope.');
        staging=fs.mkdtempSync(path.join(os.tmpdir(),'flowstride-upload-'));fs.chmodSync(staging,0o700);
        const target=path.join(staging,path.basename(path.resolve(this.config.projectRoot||process.cwd(),data.directory)));fs.mkdirSync(target,{mode:0o700});
        for(const row of rows){check();const destination=path.join(target,row.relative);fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.writeFileSync(destination,row.buffer,{flag:'wx',mode:0o600});}
        await control.setInputFiles(target,{timeout:check()});
      }else if(flags.directory&&!rows.length){
        // Playwright requires a directory path whenever this attribute is present,
        // even for []. Temporarily remove it on the same pinned element to clear
        // the selection with normal input/change events, then restore its value.
        if(!handle)handle=await locator.elementHandle({timeout:check()}) as ElementHandle<HTMLInputElement>;
        const original=await handle.getAttribute('webkitdirectory');
        await handle.evaluate(element=>element.removeAttribute('webkitdirectory'));
        try{await handle.setInputFiles([],{timeout:check()});}
        finally{await handle.evaluate((element,value)=>element.setAttribute('webkitdirectory',value??''),original).catch(()=>{});}
      }else{
        const payloads=rows.map(row=>({name:path.basename(row.file),mimeType:mime[path.extname(row.file).toLowerCase()]||'application/octet-stream',buffer:row.buffer}));
        await control.setInputFiles(payloads,{timeout:check()});
      }
      check();
      // Browser File objects read directories lazily, after setInputFiles resolves.
      // Keep the private snapshot alive until this runtime is disposed.
      if(staging){this.stagingPaths.set(staging,total);this.stagedBytes+=total;staging=undefined;}
    }catch(error){throw new Error(`File selection failed for ${label} (${rows.length} file(s), ${total} bytes): ${error instanceof Error?error.message:String(error)}`);}
    finally{await handle?.dispose().catch(()=>{});if(staging)fs.rmSync(staging,{recursive:true,force:true});}
  }
  dispose(){this.generation++;for(const event of this.pending)event.fail(new Error('File selection cancelled during cleanup.'));this.pending.clear();for(const folder of this.stagingPaths.keys())fs.rmSync(folder,{recursive:true,force:true});this.stagingPaths.clear();this.stagedBytes=0;}
}
