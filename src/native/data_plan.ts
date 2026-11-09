import path from 'node:path';
import { selectedFeatures } from '../utils/projectPaths';
import type { FeatureNode, ScenarioNode } from '../parser/parser';
import type { FlowstrideConfig } from '../types';
import { casesSchema, loadProjectData } from './project_data';
import { dataSnapshot } from './paths';

export interface CaseInfo { group: string; file: string; sha256: string; index: number; total: number; binding: string; scenario: string; format:'json'|'csv'; }
export type CaseScenario = ScenarioNode & { dataCase?: CaseInfo };
function staticFile(file: string): string {
  const resolved=file.replace(/\{\{env\.([A-Za-z_]\w*)\}\}/g,(_,key)=>{if(process.env[key]===undefined)throw new Error(`Dataset environment variable ${key} is undefined.`);return process.env[key]!;});
  if(/\{\{|@(?:[A-Za-z_]|global\[)|\$[A-Za-z_]/.test(resolved))throw new Error('Dataset paths must be fixed project paths or {{env.NAME}} references available before execution.');
  return resolved;
}
export function caseRows(config: FlowstrideConfig, file: string, format?: 'json'|'csv') {
  const result=loadProjectData(config,file,format);
  if(result.format==='text'||!Array.isArray(result.value)||!result.value.length||result.value.length>1000||result.value.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new Error(`Dataset ${JSON.stringify(file)} must contain 1–1000 JSON objects or CSV records.`);
  return {...result,format:result.format as 'json'|'csv',rows:result.value as Record<string,unknown>[]};
}

/** Expand execution instances, never the language grammar. Rows themselves do not enter reports/IPC. */
export function prepareDataFeatures(features: FeatureNode[], config: FlowstrideConfig): FeatureNode[] {
  return selectedFeatures(features).map(feature=>({...feature,scenarios:feature.scenarios.flatMap((scenario:CaseScenario,scenarioIndex)=>{
    if(scenario.dataCase || scenario.skipReason)return [scenario];
    const declarations=scenario.steps.filter(step=>step.action==='native'&&step.payload?.pluginMethod==='data.cases');
    if(!declarations.length)return [scenario];
    if(declarations.length!==1)throw new Error(`Scenario ${JSON.stringify(scenario.name)} needs exactly one flow.data.cases declaration.`);
    const step=declarations[0]!;
    if(step!==scenario.steps[0]||!/^Given(?:\s|$)/.test(step.blockDescription))throw new Error(`Line ${step.line}: flow.data.cases must be the first command in Given, before executable actions. The original Given/When/Then rules still apply.`);
    const data=casesSchema.parse(dataSnapshot(step.payload.data)),file=staticFile(data.file),dataset=caseRows(config,file,data.format);
    const key=path.resolve(config.projectRoot||process.cwd(),file);
    const manifest=config.nativeDataManifest ||= {};
    if(Object.hasOwn(manifest,key)&&manifest[key]!==dataset.sha256)throw new Error(`Dataset ${JSON.stringify(file)} changed after the run was planned. Start a new run.`);
    Object.defineProperty(manifest,key,{value:dataset.sha256,enumerable:true,writable:true,configurable:true});
    if(dataset.rows.length*scenario.steps.length>100000)throw new Error('Dataset expansion exceeds 100000 steps; split this suite into smaller files.');
    return dataset.rows.map((_,index)=>({
      ...scenario,name:`${scenario.name} [case ${index+1}/${dataset.rows.length}]`,
      dataCase:{group:`${scenarioIndex}:${scenario.name}`,file,sha256:dataset.sha256,index,total:dataset.rows.length,binding:data.as,scenario:scenario.name,format:dataset.format},
      steps:scenario.steps.map(item=>({...item,id:`${item.id}__case_${index+1}`})),
    }));
  })}));
}
