import { firefox, webkit, type Browser } from 'playwright';
import type { FlowstrideConfig } from '../types';

/** The dashboard has its own browser; it never shares test cookies or hooks. */
export class DashboardBrowser {
  private browser?: Browser;

  async open(url: string, engine: FlowstrideConfig['browser'] = 'chromium'): Promise<void> {
    if (engine === 'chromium') {
      const { default: open } = await import('open');
      await open(url);
      return;
    }
    if (engine !== 'firefox' && engine !== 'webkit') throw new Error('Unknown dashboard browser.');
    try {
      this.browser = await (engine === 'firefox' ? firefox : webkit).launch({ headless: false });
      const page = await this.browser.newPage();
      await page.goto(url);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close();
  }
}
