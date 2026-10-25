import path from 'node:path';
import { z } from 'zod';
import type { Page } from 'playwright';
import { positive, poll } from './validation';
import { isDeepStrictEqual } from 'node:util';
import { AssertionFailure, assertionCheck, diagnosticValue, reportAssertion, type AssertionCheck, type AssertionReporter, type AssertionResult } from '../reporting/assertion_result';
let accessibilityBundle: Promise<string> | undefined;
async function installAccessibilityNames(page: Page) {
  if (await page.evaluate(() => !!(window as any).__FLOWSTRIDE_ACCESSIBILITY_NAMES__)) return;
  accessibilityBundle ||= (async () => {
    const { build } = await import('vite');
    const result: any = await build({ configFile:false, root:path.dirname(require.resolve('dom-accessibility-api')), envDir:false, logLevel:'silent', build:{ write:false, minify:true, emptyOutDir:false,
      lib:{ entry:require.resolve('dom-accessibility-api'), formats:['iife'], name:'__FLOWSTRIDE_ACCESSIBILITY_NAMES__' } } });
    const code = (Array.isArray(result) ? result : [result]).flatMap(bundle => bundle.output).find((file: any) => file.type === 'chunk').code;
    return code + '\nwindow.__FLOWSTRIDE_ACCESSIBILITY_NAMES__=__FLOWSTRIDE_ACCESSIBILITY_NAMES__;';
  })();
  const source = await accessibilityBundle;
  for (const frame of page.frames()) await frame.evaluate(source);
}
const schema = z.object({ selector: z.string().optional(), role: z.string().optional(), name: z.string().optional(), frame: z.string().optional(),
  condition: z.enum(['visible','hidden','attached','enabled','disabled','editable','checked','empty','focused','text','containsText','value','values','count','attribute','css','id','property','accessibleName','accessibleDescription','inViewport','url','title','localStorage','sessionStorage']),
  value: z.unknown().optional(), attribute: z.string().optional(), property: z.string().optional(), key: z.string().optional(),
  matches: z.string().optional(), flags: z.string().regex(/^[imsu]*$/).optional(), not: z.boolean().default(false), timeout: positive.optional(),
}).strict();
export async function assertBrowser(page: Page, input: unknown, defaultTimeout: number, reporter?: AssertionReporter): Promise<void> {
  const data = schema.parse(input), timeout = data.timeout ?? defaultTimeout, started = Date.now();
  const expected: any = data.matches !== undefined ? new RegExp(data.matches, data.flags) : data.value;
  const equals = (actual: unknown) => expected instanceof RegExp ? typeof actual === 'string' && expected.test(actual) : isDeepStrictEqual(actual, expected);
  const scope = data.frame ? page.frameLocator(data.frame) : page;
  const elementCondition = !['url','title','localStorage','sessionStorage'].includes(data.condition);
  if (elementCondition && !!data.selector === !!data.role) throw new Error('Choose one selector or role.');
  const locator = data.role ? scope.getByRole(data.role as any, { name: data.name, exact: true }) : scope.locator(data.selector || 'body');
  const booleanConditions = ['visible','hidden','attached','enabled','disabled','editable','checked','empty','focused','inViewport'];
  if (!booleanConditions.includes(data.condition) && data.condition !== 'attribute' && expected === undefined) throw new Error('This assertion requires value or matches.');
  if (data.condition === 'attribute' && !data.attribute || ['css','property'].includes(data.condition) && !data.property || ['localStorage','sessionStorage'].includes(data.condition) && !data.key) throw new Error('Assertion requires an attribute, property, or storage key.');
  if (data.condition === 'count' && (!Number.isSafeInteger(expected) || expected < 0)) throw new Error('Count requires a nonnegative integer.');
  const target = elementCondition ? (data.role ? `${data.role}${data.name === undefined ? '' : ' named '+JSON.stringify(data.name)}` : data.selector!) + (data.frame ? ` inside frame ${data.frame}` : '') : data.key ? `${data.condition} key ${JSON.stringify(data.key)}` : `page ${data.condition}`;
  const needsSingle = elementCondition && !['count','attached'].includes(data.condition);
  let latest: AssertionResult = reportAssertion('assert.that', target, [{ key:'target',label:'Target lookup: '+target,status:'running' },{key:'condition',label:'condition: '+data.condition,status:'not_evaluated'}], reporter, { status:'running', timeout, elapsed:0 });
  let closed = false, lastReadError: string | undefined;
  const progress = (checks: AssertionCheck[]) => {
    if (closed) return;
    latest = reportAssertion('assert.that', target, checks, reporter, { status:'running', timeout, elapsed:Date.now()-started });
  };
  try {
    await poll(async () => {
      let count: number | undefined, roleCount: number | undefined, actual: unknown, matched = false, evaluated = false;
      let sensitive = !!data.key && /password|passcode|token|secret|authorization|cookie|api.?key|otp/i.test(data.key);
      lastReadError = undefined;
      try {
        if (elementCondition) {
          count = await locator.count();
          roleCount = data.role && data.name !== undefined && count === 0 ? await scope.getByRole(data.role as any).count() : count;
          if (count === 1 && (['value','values'].includes(data.condition) || data.attribute === 'value' || data.property === 'value')) {
            sensitive ||= await locator.evaluate(element => {
              const hints = ['type','name','id','autocomplete'].map(key=>element.getAttribute(key)||'').join(' ');
              return /password|passcode|token|secret|authorization|cookie|api.?key|one-time-code|otp/i.test(hints);
            });
          }
        }
        if (!needsSingle || count === 1 || count === 0 && ['visible','hidden'].includes(data.condition)) {
          evaluated = true;
          if (['accessibleName','accessibleDescription'].includes(data.condition)) await installAccessibilityNames(page);
          switch (data.condition) {
            case 'url': actual=page.url(); matched=equals(actual); break;
            case 'title': actual=await page.title(); matched=equals(actual); break;
            case 'localStorage': case 'sessionStorage': actual=await page.evaluate(({kind,key})=>window[kind].getItem(key),{kind:data.condition,key:data.key!});matched=equals(actual);break;
            case 'count':actual=count;matched=equals(actual);break;
            case 'attached':actual=count!>0;matched=actual===true;break;
            case 'hidden':actual=count===0||await locator.isHidden();matched=actual===true;break;
            case 'visible':actual=await locator.isVisible();matched=actual===true;break;
            case 'enabled':actual=await locator.isEnabled();matched=actual===true;break;
            case 'disabled':actual=await locator.isDisabled();matched=actual===true;break;
            case 'editable':actual=await locator.isEditable();matched=actual===true;break;
            case 'checked':actual=await locator.isChecked();matched=actual===true;break;
            case 'focused':actual=await locator.evaluate(element=>element===element.ownerDocument.activeElement);matched=actual===true;break;
            case 'empty':actual=await locator.evaluate(element=>(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement?element.value:element.textContent||'').length===0);matched=actual===true;break;
            case 'text':actual=(await locator.textContent())?.replace(/\s+/g,' ').trim();matched=equals(actual);break;
            case 'containsText':actual=(await locator.textContent()||'').replace(/\s+/g,' ').trim();matched=expected instanceof RegExp?expected.test(String(actual)):String(actual).includes(String(expected));break;
            case 'value':actual=await locator.inputValue();matched=equals(actual);break;
            case 'values':actual=await locator.evaluate(element=>Array.from((element as HTMLSelectElement).selectedOptions).map(option=>option.value));matched=equals(actual);break;
            case 'attribute':actual=await locator.getAttribute(data.attribute!);matched=expected===undefined?actual!==null:equals(actual);break;
            case 'id':actual=await locator.getAttribute('id');matched=equals(actual);break;
            case 'css':actual=await locator.evaluate((element,key)=>getComputedStyle(element).getPropertyValue(key),data.property!);matched=equals(actual);break;
            case 'property':actual=await locator.evaluate((element,key)=>(element as any)[key],data.property!);matched=equals(actual);break;
            case 'accessibleName':case 'accessibleDescription':actual=await locator.evaluate((element,condition)=>{const api=(element.ownerDocument.defaultView as any).__FLOWSTRIDE_ACCESSIBILITY_NAMES__;return condition==='accessibleName'?api.computeAccessibleName(element):api.computeAccessibleDescription(element);},data.condition);matched=equals(actual);break;
            case 'inViewport':actual=await locator.evaluate(element=>{const box=element.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>0&&box.right>0&&box.top<innerHeight&&box.left<innerWidth;});matched=actual===true;break;
          }
          if (data.not) matched=!matched;
        }
      } catch (error) { lastReadError=diagnosticValue(error instanceof Error?error.message:String(error));evaluated=false;matched=false; }
      const checks: AssertionCheck[]=[];
      if (elementCondition) {
        const absenceAllowed=count===0&&matched;
        const lookup: AssertionCheck={key:'target',label:count===0&&absenceAllowed?'Target absent as expected':'Target found: '+target,status:count===undefined?'failed':count>0||absenceAllowed?'passed':data.condition==='count'?'not_evaluated':'failed',actual:count===undefined?'Could not resolve the target':`${count} matching target(s)`};
        if(lastReadError&&count===undefined)lookup.reason=lastReadError;
        const part=(key:string,label:string,found:boolean|undefined):AssertionCheck=>({key,label,status:found===true?'passed':absenceAllowed||count===undefined||data.condition==='count'?'not_evaluated':found===false?'failed':'not_evaluated'});
        lookup.children=[];
        if(data.role)lookup.children.push(part('role','role: '+data.role,roleCount===undefined?undefined:roleCount>0));
        if(data.name!==undefined)lookup.children.push(part('name','name: '+data.name,count===undefined||!roleCount?undefined:count>0));
        if(data.selector)lookup.children.push(part('selector','selector: '+data.selector,count===undefined?undefined:count>0));
        checks.push(lookup);
        if(needsSingle&&count!==0)checks.push(count===undefined?{key:'unique',label:'Exactly one matching target',status:'not_evaluated'}:assertionCheck('unique','Exactly one matching target',count===1,1,count));
        else if(needsSingle)checks.push({key:'unique',label:'Exactly one matching target',status:'not_evaluated',reason:absenceAllowed?'A matching element is not required for this condition.':'Target lookup did not find an element.'});
      }
      const opposites:Record<string,string>={visible:'not visible',hidden:'visible',attached:'absent',enabled:'disabled',disabled:'enabled',editable:'not editable',checked:'unchecked',empty:'not empty',focused:'not focused',inViewport:'outside the viewport'};
      const positiveLabel:Record<string,string>={inViewport:'inside the viewport'};
      const wanted=sensitive?'[REDACTED]':booleanConditions.includes(data.condition)?(data.not?opposites[data.condition]:positiveLabel[data.condition]||data.condition):data.condition==='attribute'&&expected===undefined?'present':`${data.not?'not ':''}${expected instanceof RegExp?expected.toString():diagnosticValue(expected)}`;
      const observed=sensitive?'[REDACTED]':booleanConditions.includes(data.condition)&&typeof actual==='boolean'?(actual?positiveLabel[data.condition]||data.condition:opposites[data.condition]):diagnosticValue(actual);
      checks.push(evaluated?assertionCheck('condition','condition: '+data.condition+(data.attribute?' '+data.attribute:data.property?' '+data.property:''),matched,wanted,observed):{key:'condition',label:'condition: '+data.condition,status:'not_evaluated',expected:wanted,reason:lastReadError||'The target could not be resolved uniquely.'});
      if(lastReadError&&checks.at(-1))checks.at(-1)!.reason=lastReadError;
      progress(checks);
      return evaluated&&matched;
    },timeout,`${data.condition} ${target}`);
    closed=true;
    reporter?.({...latest,status:'passed',elapsed:Date.now()-started});
  } catch(error) {
    closed=true;
    const result:AssertionResult={...latest,status:'failed',elapsed:Date.now()-started,reason:diagnosticValue(error instanceof Error?error.message:String(error))};
    if(!result.checks.some(check=>check.status==='failed'))result.checks.push({key:'read',label:'Assertion could be evaluated',status:'failed',reason:lastReadError||result.reason});
    reporter?.(result);throw new AssertionFailure(result);
  }
}
