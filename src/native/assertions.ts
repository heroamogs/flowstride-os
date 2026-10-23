import path from 'node:path';
import { z } from 'zod';
import type { Page } from 'playwright';
import { positive, poll } from './validation';
import { isDeepStrictEqual } from 'node:util';
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
export async function assertBrowser(page: Page, input: unknown, defaultTimeout: number): Promise<void> {
  const data = schema.parse(input), timeout = data.timeout ?? defaultTimeout;
  const expected: any = data.matches !== undefined ? new RegExp(data.matches, data.flags) : data.value;
  const equals = (actual: unknown) => expected instanceof RegExp ? typeof actual === 'string' && expected.test(actual) : isDeepStrictEqual(actual,expected);
  const scope = data.frame ? page.frameLocator(data.frame) : page;
  const elementCondition = !['url','title','localStorage','sessionStorage'].includes(data.condition);
  if (elementCondition && !!data.selector === !!data.role) throw new Error('Choose one selector or role.');
  const locator = data.role ? scope.getByRole(data.role as any,{name:data.name,exact:true}) : scope.locator(data.selector || 'body');
  const booleanConditions = ['visible','hidden','attached','enabled','disabled','editable','checked','empty','focused','inViewport'];
  if (!booleanConditions.includes(data.condition) && data.condition !== 'attribute' && expected === undefined) throw new Error('This assertion requires value or matches.');
  if (data.condition === 'attribute' && !data.attribute || ['css','property'].includes(data.condition) && !data.property || ['localStorage','sessionStorage'].includes(data.condition) && !data.key) throw new Error('Assertion requires an attribute, property, or storage key.');
  if (data.condition === 'count' && (!Number.isSafeInteger(expected) || expected < 0)) throw new Error('Count requires a nonnegative integer.');
  await poll(async () => {
    if (['accessibleName','accessibleDescription'].includes(data.condition)) await installAccessibilityNames(page);
    let matched: boolean;
    switch (data.condition) {
      case 'url': matched=equals(page.url()); break;
      case 'title': matched=equals(await page.title()); break;
      case 'localStorage': case 'sessionStorage': matched=equals(await page.evaluate(({kind,key})=>window[kind].getItem(key),{kind:data.condition,key:data.key!})); break;
      case 'count': matched=equals(await locator.count()); break;
      case 'attached': matched=await locator.count()>0; break;
      case 'hidden': matched=await locator.count()===0 || await locator.isHidden(); break;
      case 'visible': matched=await locator.isVisible(); break;
      default: {
        if (await locator.count()!==1) return false;
        switch(data.condition) {
          case 'enabled': matched=await locator.isEnabled(); break;
          case 'disabled': matched=await locator.isDisabled(); break;
          case 'editable': matched=await locator.isEditable(); break;
          case 'checked': matched=await locator.isChecked(); break;
          case 'focused': matched=await locator.evaluate(element=>element===element.ownerDocument.activeElement); break;
          case 'empty': matched=await locator.evaluate(element=>(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value : element.textContent || '').length===0); break;
          case 'text': matched=equals((await locator.textContent())?.replace(/\s+/g,' ').trim()); break;
          case 'containsText': {const text=(await locator.textContent()||'').replace(/\s+/g,' ').trim();matched=expected instanceof RegExp ? expected.test(text) : text.includes(String(expected));break;}
          case 'value': matched=equals(await locator.inputValue()); break;
          case 'values': matched=equals(await locator.evaluate(element=>Array.from((element as HTMLSelectElement).selectedOptions).map(option=>option.value)));break;
          case 'attribute': {const value=await locator.getAttribute(data.attribute!);matched=expected===undefined ? value!==null : equals(value);break;}
          case 'id': matched=equals(await locator.getAttribute('id'));break;
          case 'css': matched=equals(await locator.evaluate((element,key)=>getComputedStyle(element).getPropertyValue(key),data.property!));break;
          case 'property': matched=equals(await locator.evaluate((element,key)=>(element as any)[key],data.property!));break;
          case 'accessibleName': case 'accessibleDescription': matched=equals(await locator.evaluate((element,condition)=>{
            const api=(element.ownerDocument.defaultView as any).__FLOWSTRIDE_ACCESSIBILITY_NAMES__;
            return condition==='accessibleName' ? api.computeAccessibleName(element) : api.computeAccessibleDescription(element);
          },data.condition));break;
          case 'inViewport': matched=await locator.evaluate(element=>{const box=element.getBoundingClientRect();return box.width>0&&box.height>0&&box.bottom>0&&box.right>0&&box.top<innerHeight&&box.left<innerWidth;});break;
          default: throw new Error('Unknown assertion condition.');
        }
      }
    }
    return data.not ? !matched : matched;
  },timeout,`${data.condition} ${data.selector||data.role||data.key||''}`);
}
