import fs from 'node:fs';
import { Lexer, TokenType } from '../parser/lexer';
import { isWorkflowToken, prepareWorkflowFeatures } from './workflow_plan';
import { Parser, type StepNode } from '../parser/parser';
import { discoverFlows } from '../utils/projectPaths';
import type { FlowstrideConfig } from '../types';

/** Old Cloud engines remain usable for their existing commands. */
export function needsNativeBrowserProtocol(target: string, config: FlowstrideConfig): boolean {
  if (config.browser && config.browser !== 'chromium' || Object.keys(config.browserOptions || {}).length ||
      config.retries || config.failOnFlaky || config.trace || config.har || config.domSnapshots || config.shard) return true;
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file =>
    new Lexer(fs.readFileSync(file,'utf8')).tokenise().some(token =>
      token.type === TokenType.ALIAS_COMMAND && /^flow\.(browser|assert|network|download|clock|stub|trace|har|a11y|component)\./i.test(token.value)));
}

/** Only new value/target contracts require the additive protocol; legacy flows stay compatible. */
export function needsNativeValueProtocol(target: string, config: FlowstrideConfig): boolean {
  const typedReference = (value: unknown): boolean => typeof value === 'string'
    ? /^@(?:[A-Za-z_]\w*|global\[[A-Za-z_]\w*\])$/.test(value)
    : Array.isArray(value) ? value.some(typedReference)
    : !!value && typeof value === 'object' && Object.values(value).some(typedReference);
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file => {
    const features = new Parser(new Lexer(fs.readFileSync(file,'utf8')).tokenise()).parse();
    return features.some(feature => feature.scenarios.some(scenario => scenario.steps.some(step => {
      if (step.action === 'extract') return ['property','network'].includes(step.payload?.target);
      if (step.action !== 'native') return false;
      const method = step.payload?.pluginMethod, data = step.payload?.data;
      return method === 'assert.value' || method === 'assert.that' && !!data && typeof data === 'object' && (
        Object.hasOwn(data,'target') || Object.hasOwn(data,'message') ||
        typeof data.property === 'string' && /[.\[]/.test(data.property) || typedReference(data.value));
    })));
  });
}

/** Execution-control syntax requires an explicit protocol; old engines keep legacy-flow handoff. */
export function needsNativeControlProtocol(target: string, config: FlowstrideConfig): boolean {
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file => {
    const features = new Parser(new Lexer(fs.readFileSync(file,'utf8')).tokenise()).parse();
    return features.some(feature => feature.scenarios.some(scenario => scenario.steps.some(step =>
      ['wait','pace','log','pause'].includes(step.action) || step.payload?.soft === true)));
  });
}

/** Browser interactions are additive; existing flows may still use older licensed engines. */
export function needsNativeInteractionProtocol(target: string, config: FlowstrideConfig): boolean {
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file => {
    const features = new Parser(new Lexer(fs.readFileSync(file,'utf8')).tokenise()).parse();
    return features.some(feature => feature.scenarios.some(scenario => scenario.steps.some(step =>
      ['press','clear','focus','blur','doubleClick','rightClick','goBack','goForward','reload','scroll'].includes(step.action) || step.action === 'native' && step.payload?.pluginMethod === 'input.type')));
  });
}

/** Additive tabs/frame/dialog semantics must never run silently in an older Cloud engine. */
export function needsNativeBrowsingProtocol(target: string, config: FlowstrideConfig): boolean {
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file => {
    const features = new Parser(new Lexer(fs.readFileSync(file,'utf8')).tokenise()).parse();
    return features.some(feature => feature.scenarios.some(scenario => scenario.steps.some(step =>
      step.action === 'native' && /^(tab|frame|dialog)\./.test(step.payload?.pluginMethod || '') ||
      step.payload?.data?.target?.element === 'iframe' || step.payload?.readableTarget?.element === 'iframe')));
  });
}

/** Fixture/data commands and their row execution contract require the matching engine. */
export function needsNativeDataProtocol(target: string, config: FlowstrideConfig): boolean {
  return discoverFlows(target,config.projectRoot||process.cwd()).some(file=>new Lexer(fs.readFileSync(file,'utf8')).tokenise().some(token=>token.type===TokenType.ALIAS_COMMAND && /^flow\.(files|data|file)\./i.test(token.value)));
}

export function needsNativeWorkflowProtocol(target: string, config: FlowstrideConfig): boolean {
  if (config.scenarioTags?.length) return true;
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file =>
    new Lexer(fs.readFileSync(file, 'utf8')).tokenise().some(isWorkflowToken));
}

function usesNativeCommand(target: string, config: FlowstrideConfig, matches: (step: StepNode) => boolean): boolean {
  return discoverFlows(target, config.projectRoot || process.cwd()).some(file => {
    const features = new Parser(new Lexer(fs.readFileSync(file, 'utf8')).tokenise()).parse();
    if (features.some(feature => feature.scenarios.some(scenario => scenario.steps.some(matches)))) return true;
    if (!features.some(feature => feature.scenarios.some(scenario => scenario.steps.some(step => step.payload?.pluginMethod === 'call')))) return false;
    const plan = prepareWorkflowFeatures(features, { ...config, nativeDataManifest: { ...config.nativeDataManifest } });
    return plan.some(feature => feature.scenarios.some(scenario => !scenario.skipReason && scenario.steps.some(matches)));
  });
}

/** Detect Batch 7 commands, including those expanded from fragments. */
export function needsNativeApiProtocol(target: string, config: FlowstrideConfig): boolean {
  return usesNativeCommand(target, config, step =>
    step.action === 'native' && (step.payload.pluginMethod.startsWith('api.') ||
      step.payload.pluginMethod === 'network.route' && step.payload.data && typeof step.payload.data === 'object' &&
      (Object.hasOwn(step.payload.data, 'delay') || Object.hasOwn(step.payload.data, 'requestBody'))));
}

export function needsNativeApplicationEvidenceProtocol(target: string, config: FlowstrideConfig): boolean {
  return usesNativeCommand(target, config, step =>
    step.action === 'native' && /^(?:console|channel|visual)\./.test(step.payload.pluginMethod));
}
