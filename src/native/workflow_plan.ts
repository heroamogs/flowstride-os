import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Lexer, TokenType, type Token } from '../parser/lexer';
import { Parser, type FeatureNode, type ScenarioNode, type StepNode } from '../parser/parser';
import { isAssertionStep } from '../parser/assertion_contract';
import type { FlowstrideConfig } from '../types';
import { projectPath, selectedFeatures } from '../utils/projectPaths';
import { prepareDataFeatures } from './data_plan';
import { readBoundedProjectFile } from './project_data';

const skipRule = z.object({
  browser: z.enum(['chromium', 'firefox', 'webkit']),
  reason: z.string().trim().min(1).max(500).regex(/^[^\x00-\x1f\x7f]+$/),
}).strict();

export function isWorkflowToken(token: Token): boolean {
  return token.type === TokenType.TAGS ||
    token.type === TokenType.ALIAS_COMMAND && /^flow\.(call|skipIf|cleanup\.register)$/i.test(token.value);
}

function isNative(step: StepNode, method: string): boolean {
  return step.action === 'native' && step.payload.pluginMethod.toLowerCase() === method.toLowerCase();
}

export function selectWorkflowFeatures(features: FeatureNode[], config: FlowstrideConfig): FeatureNode[] {
  const selected = selectedFeatures(features);
  if (!config.scenarioTags?.length) return selected;
  const wanted = new Set(config.scenarioTags);
  return selected.map(feature => ({
    ...feature,
    scenarios: feature.scenarios.filter(scenario => scenario.tags?.some(tag => wanted.has(tag))),
  })).filter(feature => feature.scenarios.length);
}

function scenarioSkip(scenario: ScenarioNode, config: FlowstrideConfig): string | undefined {
  const index = scenario.steps.findIndex(step => isNative(step, 'skipIf'));
  if (index === -1) return;
  const step = scenario.steps[index];
  const expected = scenario.steps[0] && isNative(scenario.steps[0], 'data.cases') ? 1 : 0;
  if (index !== expected || !/^Given(?:\s|$)/.test(step.blockDescription) ||
      scenario.steps.slice(index + 1).some(item => isNative(item, 'skipIf'))) {
    throw new Error(`Line ${step.line}: Place one flow.skipIf at the start of Given, immediately after flow.data.cases if present.`);
  }
  const rule = skipRule.safeParse(step.payload.data);
  if (!rule.success) throw new Error(`Line ${step.line}: flow.skipIf requires a supported browser and a nonempty reason of up to 500 characters.`);
  if (rule.data.browser === (config.browser || 'chromium')) return rule.data.reason;
}

function fragmentReader(config: FlowstrideConfig) {
  const root = config.projectRoot || process.cwd();
  const cache = new Map<string, { key: string; file: string; steps: StepNode[] }>();
  return (input: unknown) => {
    if (typeof input !== 'string' || input.length > 1000 || path.isAbsolute(input) ||
        !input.endsWith('.flowpart') || /[\\\x00-\x1f@${}:]/.test(input) ||
        input.split('/').includes('..')) {
      throw new Error('flow.call requires a fixed project-relative .flowpart path.');
    }
    const absolute = projectPath(root, input);
    const key = fs.realpathSync(absolute);
    const previous = cache.get(absolute);
    if (previous) return previous;
    if (cache.size >= 64) throw new Error('A flow can load at most 64 distinct command fragments.');
    const buffer = readBoundedProjectFile(config, input, 256 * 1024);
    const sha = createHash('sha256').update(buffer).digest('hex');
    const manifest = config.nativeDataManifest ??= {};
    if (Object.hasOwn(manifest, absolute) && manifest[absolute] !== sha) {
      throw new Error(`Fragment ${JSON.stringify(input)} changed after planning. Start a new run.`);
    }
    manifest[absolute] = sha;
    const file = path.relative(fs.realpathSync(root), key).split(path.sep).join('/');
    let steps: StepNode[];
    try {
      const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      steps = new Parser(new Lexer(source).tokenise()).parseFragment();
    } catch (error) {
      throw new Error(`Fragment ${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const fragment = { key, file, steps };
    cache.set(absolute, fragment);
    return fragment;
  };
}

export function prepareWorkflowFeatures(features: FeatureNode[], config: FlowstrideConfig): FeatureNode[] {
  const readFragment = fragmentReader(config);
  const selected = selectWorkflowFeatures(features, config);
  return prepareDataFeatures(selected.map(feature => ({
    ...feature,
    scenarios: feature.scenarios.map(scenario => {
      const skipReason = scenarioSkip(scenario, config);
      if (skipReason) return { ...scenario, skipReason };
      if (!scenario.steps.some(step => isNative(step, 'call'))) return scenario;

      const steps: StepNode[] = [];
      const append = (step: StepNode, ancestors: string[]): void => {
        if (steps.length >= 10000) throw new Error('A scenario can expand to at most 10000 commands.');
        if (!isNative(step, 'call')) {
          if (ancestors.length && (isNative(step, 'data.cases') || isNative(step, 'skipIf'))) {
            throw new Error(`${step.sourceFile}:${step.line}: Scenario declarations belong in Given outside a fragment.`);
          }
          if (ancestors.length && /^And(?:\s|$)/.test(step.blockDescription) &&
              !isAssertionStep(step.action, step.payload)) {
            throw new Error(`${step.sourceFile}:${step.line}: An And block may call only assertion commands.`);
          }
          steps.push(step);
          return;
        }
        if (ancestors.length >= 8) throw new Error('Command fragments may nest at most 8 levels.');
        try {
          const fragment = readFragment(step.payload.data);
          if (ancestors.includes(fragment.key)) throw new Error(`Recursive fragment call to ${fragment.file}.`);
          fragment.steps.forEach((child, index) => append({
            ...child,
            id: `${step.id}__part_${index + 1}`,
            blockDescription: step.blockDescription,
            sourceFile: fragment.file,
            isStop: step.isStop && index === fragment.steps.length - 1,
          }, [...ancestors, fragment.key]));
        } catch (error) {
          const location = step.sourceFile ? `${step.sourceFile}:${step.line}` : `Line ${step.line}`;
          throw new Error(`${location}: flow.call: ${error instanceof Error ? error.message : String(error)}`);
        }
      };
      scenario.steps.forEach(step => append(step, []));
      return { ...scenario, steps };
    }),
  })), config);
}
