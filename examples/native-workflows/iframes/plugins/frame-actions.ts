/** A project extension for an explicit frame action; not a private runner import. */
export async function click(sdk: any, args: { frame: string; selector: string }) {
  if (typeof args.frame !== 'string' || typeof args.selector !== 'string') {
    throw new Error('frame and selector must be strings');
  }
  await sdk.browser.page().frameLocator(args.frame).locator(args.selector).click();
}
