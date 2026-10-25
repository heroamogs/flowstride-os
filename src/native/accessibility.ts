import { AssertionFailure, assertionCheck, requireAssertion, reportAssertion, diagnosticValue, type AssertionResult, type AssertionReporter } from '../reporting/assertion_result';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { name, evidencePath, positive, readProjectFile, poll } from './validation';
import { projectPath } from '../utils/projectPaths';
import type { FlowstrideConfig } from '../types';
export async function accessibility(page: Page, config: FlowstrideConfig, action: string, input: unknown, reporter?: AssertionReporter) {
  if (action === 'scan') {
    const data = z.object({ name: name.default('accessibility'), include: z.array(z.string()).optional(), exclude: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), rules: z.array(z.string()).optional(), disableRules: z.array(z.string()).optional(), impacts: z.array(z.enum(['minor','moderate','serious','critical'])).optional(), maxViolations: z.number().int().nonnegative().default(0) }).strict().parse(input);
    let builder = new AxeBuilder({ page });
    for (const selector of data.include || []) builder = builder.include(selector);
    for (const selector of data.exclude || []) builder = builder.exclude(selector);
    if (data.tags) builder = builder.withTags(data.tags);
    if (data.rules) builder = builder.withRules(data.rules);
    if (data.disableRules) builder = builder.disableRules(data.disableRules);
    const result = await builder.analyze();
    const violations = result.violations.filter(item => !data.impacts || item.impact && data.impacts.includes(item.impact as any));
    const file = evidencePath(config, `${data.name}-${Date.now()}.json`);
    // Reports may contain application content. They remain in local evidence.
    fs.writeFileSync(file, JSON.stringify({ ...result, violations }, null, 2), { mode: 0o600 });
    requireAssertion('a11y.scan','accessibility scan '+data.name,[assertionCheck('violations','Violation count within the allowed maximum',violations.length<=data.maxViolations,`at most ${data.maxViolations}`,violations.length)],reporter,{reason:violations.length>data.maxViolations?`Accessibility assertion failed: ${violations.length} violations (${violations.map(item=>item.id).slice(0,30).join(', ')}). Report: ${file}`:undefined});
    return file;
  }
  if (action === 'snapshot') {
    const data = z.object({ name, selector: z.string().default('body'), baseline: z.string().optional(), update: z.boolean().default(false), timeout: positive.optional() }).strict().parse(input);
    const snapshot = await page.locator(data.selector).ariaSnapshot({ timeout: data.timeout ?? config.timeout });
    const file = evidencePath(config, `${data.name}-${Date.now()}.aria.yml`);
    fs.writeFileSync(file, snapshot, { mode: 0o600 });
    if (!data.baseline) { if (data.update) throw new Error('Choose a baseline path.'); return file; }
    const baseline = projectPath(config.projectRoot || process.cwd(), data.baseline);
    if (data.update || config.updateBaselines) {
      if (config.ci || process.env.CI && process.env.CI !== 'false') throw new Error('Baseline updates are not allowed in CI.');
      if (!config.updateBaselines) throw new Error('Baseline writing requires --update-baselines.');
      fs.mkdirSync(path.dirname(baseline), { recursive: true }); fs.writeFileSync(baseline, snapshot, { mode: 0o600 });
    } else {
      const expected = readProjectFile(config, baseline).toString('utf8').replace(/\r\n/g, '\n').trim();
      requireAssertion('a11y.snapshot','ARIA baseline '+data.baseline,[assertionCheck('baseline','ARIA baseline matches',expected===snapshot.trim(),expected,snapshot.trim())],reporter,{reason:expected!==snapshot.trim()?`ARIA baseline differs. Review the captured snapshot before updating: ${file}`:undefined});
    }
    return file;
  }
  if (action === 'match') {
    const data = z.object({ selector: z.string().default('body'), yaml: z.string().min(1), timeout: positive.optional() }).strict().parse(input);
    const started=Date.now(),timeout=data.timeout??config.timeout;
    let latest:AssertionResult=reportAssertion('a11y.match','ARIA snapshot '+data.selector,[{key:'snapshot',label:'ARIA snapshot matches',status:'running'}],reporter,{status:'running',timeout,elapsed:0});let closed=false;
    try{
      await poll(async()=>{const actual=(await page.locator(data.selector).ariaSnapshot()).trim(),expected=data.yaml.replace(/\r\n/g,'\n').trim();const check=assertionCheck('snapshot','ARIA snapshot matches',actual===expected,expected,actual);if(!closed)latest=reportAssertion('a11y.match','ARIA snapshot '+data.selector,[check],reporter,{status:'running',timeout,elapsed:Date.now()-started});return check.status==='passed';},timeout,'ARIA snapshot differs');
      closed=true;reporter?.({...latest,status:'passed',elapsed:Date.now()-started});
    }catch(error){closed=true;const result:AssertionResult={...latest,status:'failed',elapsed:Date.now()-started,reason:diagnosticValue(error instanceof Error?error.message:String(error))};for(const check of result.checks)if(check.status==='running')check.status='failed';reporter?.(result);throw new AssertionFailure(result);}
    return;

  }
  throw new Error(`Unknown accessibility action: ${action}`);
}
