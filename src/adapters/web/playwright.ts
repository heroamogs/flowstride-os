import * as fs from "fs";
import * as path from "path";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { Browser, BrowserContext, Page, Locator, Dialog } from "playwright";
import { FlowstrideConfig } from "../../types";

chromium.use(stealthPlugin());

export class WebAdapter {
  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private page: Page | null = null;

  private discoveredPages: Page[] = [];

  private dialogHandler: ((dialog: Dialog) => Promise<void>) | null = null;

  constructor(private config: FlowstrideConfig) {}

  public getPage(): Page {
    if (!this.page) throw new Error("Browser not initialised");

    return this.page;
  }

  public async initialise(audioInjectionPath?: string): Promise<void> {
    const launchArgs = this.config.headless
      ? [
          "--use-fake-ui-for-media-stream",

          "--use-fake-device-for-media-stream",

          "--disable-blink-features=AutomationControlled", // Cloudflare Mask
        ]
      : [
          "--window-size=1280,800",

          "--use-fake-ui-for-media-stream",

          "--use-fake-device-for-media-stream",

          "--disable-blink-features=AutomationControlled", // Cloudflare Mask
        ];

    if (audioInjectionPath) {
      launchArgs.push(
        `--use-file-for-fake-audio-capture=${audioInjectionPath}`,
      );
    }

    this.browser = await chromium.launch({
      headless: this.config.headless,

      args: launchArgs,
    });

    const videoDir = path.join(process.cwd(), ".flowstride", "videos");

    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    const customUserAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    this.context = await this.browser.newContext({
      viewport: null,

      userAgent: customUserAgent,

      recordVideo: {
        dir: videoDir,

        size: { width: 1280, height: 800 },
      },
    });

    this.context.on("dialog", async (dialog) => {
      if (this.dialogHandler) {
        await this.dialogHandler(dialog);
      } else {
        if (this.config.defaultDialogBehavior === "accept") {
          await dialog.accept().catch(() => {});
        } else {
          await dialog.dismiss().catch(() => {});
        }
      }
    });

    this.context.on("page", (page) => {
      this.discoveredPages.push(page);

      page.waitForLoadState("domcontentloaded").catch(() => {});
    });

    this.page = await this.context.newPage();

    this.page.setDefaultTimeout(this.config.timeout);
  }

  public async acceptDialog(): Promise<void> {
    this.dialogHandler = async (dialog: Dialog) => {
      await dialog.accept();
    };
  }

  public async rejectDialog(): Promise<void> {
    this.dialogHandler = async (dialog: Dialog) => {
      await dialog.dismiss();
    };
  }

  public async injectAudio(filePath: string): Promise<void> {
    const absolutePath = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Audio file not found at: ${absolutePath}`);
    }

    console.log(`Audio feed active, streaming from: ${absolutePath}`);
  }

  public async switchTo(target: string): Promise<void> {
    if (!this.context || !this.page) throw new Error("Browser not initialised");

    const targetLower = target.toLowerCase();

    let pages = this.context.pages();

    let currentIndex = pages.indexOf(this.page);

    if (targetLower === "next") {
      const timeout = this.config.timeout || 30000;

      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        pages = this.context.pages();

        if (pages.length > currentIndex + 1) break;

        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      pages = this.context.pages();

      currentIndex = pages.indexOf(this.page);

      if (currentIndex < pages.length - 1) {
        this.page = pages[currentIndex + 1];
      } else {
        throw new Error(
          `No new tab or window was detected after waiting ${timeout / 1000} seconds.`,
        );
      }
    } else if (targetLower === "previous") {
      if (currentIndex > 0) {
        this.page = pages[currentIndex - 1];
      } else {
        throw new Error("No previous tab available to switch to.");
      }
    } else {
      let found = false;

      const cleanTarget = target.replace(/^['"]|['"]$/g, "");

      for (const p of pages) {
        const title = await p.title().catch(() => "");

        const url = p.url();

        if (title.includes(cleanTarget) || url.includes(cleanTarget)) {
          this.page = p;

          found = true;

          break;
        }
      }

      if (!found) {
        throw new Error(
          `Could not find any open tab matching "${cleanTarget}".`,
        );
      }
    }

    await this.page.bringToFront();

    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  public async injectStorage(
    cookies?: any[],

    localStorage?: Record<string, string>,

    fallbackDomain?: string,
  ): Promise<void> {
    if (!this.context || !this.page) return;

    if (cookies && cookies.length > 0) {
      const formattedCookies: any[] = [];

      for (const cookie of cookies) {
        if (typeof cookie === "string") {
          const parts = cookie.split(";").map((c) => c.trim());

          const nameValue = parts[0];

          const splitIndex = nameValue.indexOf("=");

          if (splitIndex === -1) continue;

          const name = nameValue.substring(0, splitIndex);

          const value = nameValue.substring(splitIndex + 1);

          let domain =
            fallbackDomain ||
            new URL(this.config.baseUrl || "http://localhost").hostname;

          let path = "/";

          for (let i = 1; i < parts.length; i++) {
            const attr = parts[i].toLowerCase();

            if (attr.startsWith("domain=")) domain = parts[i].substring(7);

            if (attr.startsWith("path=")) path = parts[i].substring(5);
          }

          domain = domain.replace(/^https?:\/\//, "").split(":")[0];

          formattedCookies.push({ name, value, domain, path });
        } else {
          formattedCookies.push(cookie);
        }
      }

      await this.context.addCookies(formattedCookies);
    }

    if (localStorage && Object.keys(localStorage).length > 0) {
      await this.page.addInitScript((data) => {
        for (const [k, v] of Object.entries(data)) {
          window.localStorage.setItem(k, v as string);
        }
      }, localStorage);

      if (this.page.url() !== "about:blank") {
        await this.page.evaluate((data) => {
          try {
            for (const [k, v] of Object.entries(data))
              window.localStorage.setItem(k, v as string);
          } catch (e) {}
        }, localStorage);
      }
    }
  }

  public async getState(): Promise<{
    cookies: any[];

    localStorage: Record<string, string>;

    sessionStorage: Record<string, string>;
  }> {
    const cookies = (await this.context?.cookies()) || [];

    let localStorage = {};

    let sessionStorage = {};

    if (this.page && this.page.url() !== "about:blank") {
      try {
        localStorage = await this.page.evaluate(() => ({
          ...window.localStorage,
        }));

        sessionStorage = await this.page.evaluate(() => ({
          ...window.sessionStorage,
        }));
      } catch (e) {
        console.warn(
          "Warning: Could not access storage. Ensure page is loaded.",
        );
      }
    }

    return { cookies, localStorage, sessionStorage };
  }

  public getCurrentUrl(): string {
    return this.page ? this.page.url() : "about:blank";
  }

  public async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser page is not initialized.");

    let finalUrl = url;

    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      const base = this.config.baseUrl || "http://localhost";

      try {
        finalUrl = new URL(url, base).href;
      } catch (e) {
        const cleanBase = base.replace(/\/$/, "");

        const cleanUrl = url.startsWith("/") ? url : `/${url}`;

        finalUrl = `${cleanBase}${cleanUrl}`;
      }
    }

    await this.page.goto(finalUrl, {
      waitUntil: "domcontentloaded",
    });
  }

  public synthesizeCurl(
    method: string,

    url: string,

    headers: Record<string, string>,

    postData: string | null,
  ): string {
    let curl = `curl -X ${method.toUpperCase()} '${url}'`;

    for (const [key, value] of Object.entries(headers)) {
      if (key.startsWith(":")) continue;

      const safeValue = value.replace(/'/g, "'\\''");

      curl += ` \\\n -H '${key}: ${safeValue}'`;
    }

    if (postData) {
      const safeData = postData.replace(/'/g, "'\\''");

      curl += ` \\\n -d '${safeData}'`;
    }

    return curl;
  }

  private async checkAmbiguity(
    loc: Locator,

    selector: string,
  ): Promise<Locator> {
    if (/\[\d+\]/.test(selector)) return loc.first();

    const count = await loc.count();

    if (count === 0) return loc.first();

    if (count === 1) return loc.first();

    const uniqueElements: { box: any; index: number; isActionable: boolean }[] =
      [];

    for (let i = 0; i < count; i++) {
      const el = loc.nth(i);

      const box = await el.boundingBox();

      if (!box || box.width === 0 || box.height === 0) continue;

      let isDuplicate = false;

      for (const u of uniqueElements) {
        const isIntersecting = !(
          box.x > u.box.x + u.box.width ||
          box.x + box.width < u.box.x ||
          box.y > u.box.y + u.box.height ||
          box.y + box.height < u.box.y
        );

        if (isIntersecting) {
          isDuplicate = true;

          const tagName = await el.evaluate((n) => n.tagName.toLowerCase());

          if (["a", "button", "input", "select"].includes(tagName)) {
            u.index = i;

            u.isActionable = true;
          }

          break;
        }
      }

      if (!isDuplicate) {
        const tagName = await el.evaluate((n) => n.tagName.toLowerCase());

        const role = await el.getAttribute("role");

        const isActionable =
          ["a", "button", "input", "select"].includes(tagName) ||
          ["button", "link"].includes(role || "");

        uniqueElements.push({ box, index: i, isActionable });
      }
    }

    if (uniqueElements.length === 1) {
      return loc.nth(uniqueElements[0].index);
    }

    const actionableElements = uniqueElements.filter((e) => e.isActionable);

    if (actionableElements.length === 1) {
      return loc.nth(actionableElements[0].index);
    }

    throw new Error(
      `Ambiguity Error: I found ${uniqueElements.length} visually distinct elements matching "${selector}" on the screen. To fix this, please specify an element type (e.g., "link" under "Cars") or use a 0-based index (e.g., "[0]").`,
    );
  }

  public async close(targetText: string): Promise<void> {
    const cleanText = targetText.replace(/^['"]|['"]$/g, "");

    const textLoc = this.page!.locator(
      `:text-is("${cleanText}"), :has-text("${cleanText}")`,
    )

      .filter({ visible: true })

      .last();

    if ((await textLoc.count()) === 0) {
      throw new Error(
        `Geometric Close Error: Could not find any open modal containing the text "${cleanText}".`,
      );
    }

    const clickCoords = await textLoc.evaluate((node) => {
      let container = node as HTMLElement;

      while (container && container !== document.body) {
        const style = window.getComputedStyle(container);

        const isDialog = container.getAttribute("role") === "dialog";

        const isModalClass =
          container.className &&
          typeof container.className === "string" &&
          container.className.toLowerCase().includes("modal");

        const isFixedPopup =
          (style.position === "fixed" || style.position === "absolute") &&
          parseInt(style.zIndex || "0") > 10;

        if (isDialog || isModalClass || isFixedPopup) {
          break;
        }

        container = container.parentElement as HTMLElement;
      }

      if (!container || container === document.body) {
        container = node.parentElement?.parentElement || (node as HTMLElement);
      }

      const box = container.getBoundingClientRect();

      const candidates = Array.from(
        container.querySelectorAll('button, svg, a, [role="button"], img'),
      );

      let bestCandidate: HTMLElement | null = null;

      let minDistance = Infinity;

      const topRightX = box.right;

      const topRightY = box.top;

      candidates.forEach((el) => {
        const elBox = el.getBoundingClientRect();

        if (elBox.width === 0 || elBox.height === 0) return;

        const isTopRight =
          elBox.left >= box.left + box.width * 0.5 &&
          elBox.top <= box.top + box.height * 0.5;

        if (isTopRight) {
          const distance = Math.sqrt(
            Math.pow(topRightX - elBox.right, 2) +
              Math.pow(topRightY - elBox.top, 2),
          );

          if (distance < minDistance) {
            minDistance = distance;

            bestCandidate = el as HTMLElement;
          }
        }
      });

      if (bestCandidate) {
        const finalBox = (bestCandidate as HTMLElement).getBoundingClientRect();

        return {
          x: finalBox.left + finalBox.width / 2,

          y: finalBox.top + finalBox.height / 2,
        };
      }

      return { x: box.right - 20, y: box.top + 20 };
    });

    await this.page!.mouse.move(clickCoords.x, clickCoords.y);

    await this.page!.mouse.down();

    await this.page!.mouse.up();

    await this.page!.waitForTimeout(300);
  }

  public async click(selector: string, elementType?: string): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.waitFor({ state: "visible" });

    await targetLoc.scrollIntoViewIfNeeded();

    await targetLoc.click();
  }

  public async type(
    selector: string,

    value: string,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.waitFor({ state: "visible" });

    await targetLoc.scrollIntoViewIfNeeded();

    let success = false;

    const isMac = process.platform === "darwin";

    const selectAllModifier = isMac ? "Meta+A" : "Control+A";

    for (let attempt = 1; attempt <= 3; attempt++) {
      await targetLoc.click({ clickCount: 3 });

      await targetLoc.press(selectAllModifier);

      await targetLoc.press("Backspace");

      await targetLoc.fill("");

      await targetLoc.pressSequentially(value, { delay: 30 });

      await targetLoc.evaluate((node) => node.blur());

      let actualValue = "";

      try {
        actualValue = await targetLoc.inputValue({ timeout: 500 });
      } catch {
        actualValue = (await targetLoc.textContent({ timeout: 500 })) || "";
      }

      const cleanActual = actualValue.replace(/[^a-zA-Z0-9]/g, "");

      const cleanExpected = value.replace(/[^a-zA-Z0-9]/g, "");

      if (
        actualValue === value ||
        cleanActual === cleanExpected ||
        (cleanExpected.length > 0 && cleanActual.includes(cleanExpected))
      ) {
        success = true;

        break;
      } else {
        await this.page!.waitForTimeout(200);
      }
    }

    if (!success) {
      throw new Error(
        `Framework rejected typing. Expected "${value}" but the field remained empty or mismatched.`,
      );
    }
  }

  public async passcode(
    selector: string,

    value: string,

    elementType?: string,
  ): Promise<void> {
    let loc = await this.getLocator(selector, elementType, true, false);

    let inputs = loc;

    let count = await inputs.count();

    if (count === 1) {
      const tagName = await inputs.evaluate((n) => n.tagName.toLowerCase());

      if (tagName !== "input") {
        inputs = inputs.locator("input");

        count = await inputs.count();
      }
    }

    if (count === 0) {
      inputs = this.page!.locator(
        'input[maxlength="1"], input[inputmode="numeric"], input[autocomplete="one-time-code"]',
      );

      count = await inputs.count();

      if (count > 8) {
        inputs = this.page!.locator(
          'form input[maxlength="1"], [role="dialog"] input[maxlength="1"]',
        );

        count = await inputs.count();
      }
    }

    if (count === 0) {
      throw new Error(
        `Passcode Error: Could not find any input fields (even hidden ones) matching "${selector}".`,
      );
    }

    if (count === 1) {
      await inputs.fill(value, { force: true });

      await inputs.evaluate((node: any, val: string) => {
        node.value = val;

        node.dispatchEvent(
          new Event("input", { bubbles: true, composed: true }),
        );

        node.dispatchEvent(
          new Event("change", { bubbles: true, composed: true }),
        );
      }, value);

      return;
    }

    const chars = value.split("");

    for (let i = 0; i < Math.min(chars.length, count); i++) {
      const inputLoc = inputs.nth(i);

      await inputLoc.scrollIntoViewIfNeeded().catch(() => {});

      await inputLoc

        .evaluate((node: HTMLElement) => node.focus())

        .catch(() => {});

      await inputLoc.evaluate((node: HTMLInputElement) => (node.value = ""));

      try {
        await inputLoc.pressSequentially(chars[i], { delay: 30 });
      } catch {
        await inputLoc.evaluate((node: HTMLInputElement, char: string) => {
          node.value = char;
        }, chars[i]);
      }

      await inputLoc.evaluate((node: HTMLInputElement) => {
        node.dispatchEvent(
          new Event("input", { bubbles: true, composed: true }),
        );

        node.dispatchEvent(
          new Event("change", { bubbles: true, composed: true }),
        );
      });

      await this.page!.waitForTimeout(50);
    }
  }

  public async check(selector: string, elementType?: string): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.waitFor({ state: "visible" });

    await targetLoc.scrollIntoViewIfNeeded();

    try {
      await targetLoc.check({ timeout: 1500 });
    } catch (error: any) {
      if (error.message.includes("Not a checkbox or radio button")) {
        const isChecked = await targetLoc.evaluate((node) => {
          return (
            node.getAttribute("aria-checked") === "true" ||
            node.classList.contains("checked") ||
            node.classList.contains("active") ||
            node.classList.contains("selected")
          );
        });

        if (!isChecked) {
          await targetLoc.click({ force: true });
        }
      } else {
        throw error;
      }
    }
  }

  public async uncheck(selector: string, elementType?: string): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.waitFor({ state: "visible" });

    await targetLoc.scrollIntoViewIfNeeded();

    try {
      await targetLoc.uncheck({ timeout: 1500 });
    } catch (error: any) {
      if (error.message.includes("Not a checkbox or radio button")) {
        const isChecked = await targetLoc.evaluate((node) => {
          return (
            node.getAttribute("aria-checked") === "true" ||
            node.classList.contains("checked") ||
            node.classList.contains("active") ||
            node.classList.contains("selected")
          );
        });

        if (isChecked) {
          await targetLoc.click({ force: true });
        }
      } else {
        throw error;
      }
    }
  }

  public async upload(
    selector: string,

    filePath: string,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.waitFor({ state: "visible" });

    await targetLoc.scrollIntoViewIfNeeded();

    const absolutePath = path.resolve(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(
        `File Upload Error: Could not find the file at "${absolutePath}". Please ensure the file exists in your project directory.`,
      );
    }

    try {
      const fileChooserPromise = this.page!.waitForEvent("filechooser", {
        timeout: 5000,
      });

      await targetLoc.click();

      const fileChooser = await fileChooserPromise;

      await fileChooser.setFiles(absolutePath);
    } catch (e) {
      try {
        await targetLoc.setInputFiles(absolutePath);
      } catch (fallbackError) {
        throw new Error(
          `Failed to upload file. The element "${selector}" did not trigger a native file dialog, nor is it a direct file input.`,
        );
      }
    }
  }

  public async set(
    selector: string,

    value: string,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(selector, elementType, true, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    const isDateValue = /^\d{4}-\d{2}-\d{2}/.test(value);

    await targetLoc.evaluate((node: any, val: string) => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,

        "value",
      )?.set;

      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(node, val);
      } else {
        node.value = val;
      }

      if (node.setAttribute) node.setAttribute("value", val);

      const stateAttributes = [
        "aria-valuenow",

        "data-value",

        "data-date",

        "data-selected",

        "data-time",
      ];

      stateAttributes.forEach((attr) => {
        if (node.hasAttribute(attr)) {
          node.setAttribute(attr, val);
        }
      });

      node.dispatchEvent(new Event("input", { bubbles: true, composed: true }));

      node.dispatchEvent(
        new Event("change", { bubbles: true, composed: true }),
      );

      node.dispatchEvent(new Event("blur", { bubbles: true, composed: true }));
    }, value);

    await this.page!.waitForTimeout(200);

    let finalValue = "";

    try {
      finalValue = await targetLoc.inputValue({ timeout: 200 });
    } catch {
      finalValue =
        (await targetLoc.getAttribute("value", { timeout: 200 })) || "";
    }

    const targetDatePart = value.split("T")[0];

    if (isDateValue && !finalValue.includes(targetDatePart)) {
      await this.fallbackCalendarSelect(targetLoc, value);
    }
  }

  private async fallbackCalendarSelect(
    targetLoc: Locator,

    dateValue: string,
  ): Promise<void> {
    await targetLoc.click({ force: true });

    await this.page!.waitForTimeout(500);

    const date = new Date(dateValue);

    if (isNaN(date.getTime())) return;

    const month = date.toLocaleString("default", { month: "long" });

    const day = date.getDate();

    const year = date.getFullYear();

    const dateLabelPart = `${month} ${day}`;

    const accessibleCellLocator = this.page!.locator(
      `[role="gridcell"][aria-label*="${dateLabelPart}"][aria-label*="${year}"], ` +
        `[role="button"][aria-label*="${dateLabelPart}"][aria-label*="${year}"]`,
    ).filter({ visible: true });

    const rawClassLocator = this.page!.locator(
      `.react-datepicker__day--0${day.toString().padStart(2, "0")}, ` +
        `.day:has-text("${day}")`,
    ).filter({ visible: true });

    const targetDay =
      (await accessibleCellLocator.count()) > 0
        ? accessibleCellLocator
        : rawClassLocator;

    if ((await targetDay.count()) > 0) {
      await targetDay.first().click({ force: true });

      await this.page!.waitForTimeout(300);
    } else {
      throw new Error(
        `Framework rejected direct date injection, and semantic calendar scanner could not find a visible cell for "${month} ${day}, ${year}".`,
      );
    }
  }

  public async select(
    option: string,

    selector: string,

    elementType?: string,
  ): Promise<void> {
    const rawLoc = await this.getLocator(selector, elementType, false, false);

    const targetLoc = await this.checkAmbiguity(rawLoc, selector);

    await targetLoc.waitFor({ state: "visible" });

    const isReady = await targetLoc.evaluate((n: any) => {
      const disabled =
        n.disabled ||
        n.getAttribute("aria-disabled") === "true" ||
        n.classList.contains("disabled");

      return !disabled;
    });

    if (!isReady) {
      throw new Error(`Dropdown "${selector}" is currently disabled.`);
    }

    await targetLoc.scrollIntoViewIfNeeded();

    const tagName = await targetLoc.evaluate((n) => n.tagName.toLowerCase());

    if (tagName === "select") {
      await targetLoc.selectOption({ label: option });

      return;
    }

    await targetLoc.click({ force: true });

    await this.page!.waitForTimeout(300);

    const activeElement = await this.page!.evaluateHandle(
      () => document.activeElement,
    );

    const activeTagName = await activeElement.evaluate((n: any) =>
      n?.tagName?.toLowerCase(),
    );

    if (activeTagName === "input") {
      await activeElement.asElement()?.fill(option);

      await this.page!.waitForTimeout(400);
    }

    const dropdownClasses =
      '.select__menu, .MuiPopover-root, [role="listbox"], [role="menu"], .dropdown-menu';

    const portalContainer = this.page!.locator(dropdownClasses)

      .filter({ visible: true })

      .last();

    const cleanOptionText = option.replace(/^['"]|['"]$/g, "");

    let optionFound = false;

    let optionLoc: Locator;

    const optionSelector = `:is([role="option"], .select__option, li):has-text("${cleanOptionText}"), :text-is("${cleanOptionText}")`;

    if ((await portalContainer.count()) > 0) {
      optionLoc = portalContainer.locator(optionSelector).first();

      if ((await optionLoc.count()) === 0) {
        optionLoc = this.page!.locator(optionSelector)

          .filter({ visible: true })

          .first();
      }
    } else {
      optionLoc = this.page!.locator(optionSelector)

        .filter({ visible: true })

        .first();
    }

    for (let i = 0; i < 8; i++) {
      if ((await optionLoc.count()) > 0 && (await optionLoc.isVisible())) {
        optionFound = true;

        break;
      }

      if ((await portalContainer.count()) > 0) {
        await portalContainer

          .evaluate((node) => node.scrollBy(0, 150))

          .catch(() => {});

        await this.page!.waitForTimeout(250);
      } else {
        break;
      }
    }

    if (!optionFound) {
      throw new Error(
        `Could not find the option "${option}" in the dropdown "${selector}".`,
      );
    }

    await optionLoc.scrollIntoViewIfNeeded().catch(() => {});

    await optionLoc.click({ force: true });

    await this.page!.waitForTimeout(200);
  }

  public async drag(
    sourceSelector: string,

    destinationSelector: string,
  ): Promise<void> {
    const sourceLocRaw = await this.getLocator(
      sourceSelector,

      undefined,

      false,

      false,
    );

    const sourceLoc = await this.checkAmbiguity(sourceLocRaw, sourceSelector);

    const destLocRaw = await this.getLocator(
      destinationSelector,

      undefined,

      false,

      false,
    );

    const destLoc = await this.checkAmbiguity(destLocRaw, destinationSelector);

    await sourceLoc.waitFor({ state: "visible" });

    await destLoc.waitFor({ state: "visible" });

    await sourceLoc.scrollIntoViewIfNeeded().catch(() => {});

    await destLoc.scrollIntoViewIfNeeded().catch(() => {});

    const srcBox = await sourceLoc.boundingBox();

    const dstBox = await destLoc.boundingBox();

    if (!srcBox || !dstBox) return;

    const startX = srcBox.x + srcBox.width / 2;

    const startY = srcBox.y + srcBox.height / 2;

    const endX = dstBox.x + dstBox.width / 2;

    const endY = dstBox.y + dstBox.height / 2;

    try {
      await sourceLoc.dragTo(destLoc, { force: true, timeout: 1000 });
    } catch (e) {}

    await this.page!.waitForTimeout(300);

    try {
      await this.page!.mouse.move(startX, startY);

      await this.page!.mouse.down();

      await this.page!.waitForTimeout(200);

      await this.page!.mouse.move(startX + 10, startY + 10, { steps: 5 });

      await this.page!.waitForTimeout(200);

      await this.page!.mouse.move(endX, endY, { steps: 15 });

      await this.page!.waitForTimeout(200);

      await this.page!.mouse.up();
    } catch (e) {}

    await this.page!.waitForTimeout(300);

    try {
      const srcEl = await sourceLoc.elementHandle();

      const dstEl = await destLoc.elementHandle();

      if (srcEl && dstEl) {
        await this.page!.evaluate(
          ([s, d]) => {
            const actualSrc =
              ((s as HTMLElement).closest(
                '[draggable="true"]',
              ) as HTMLElement) || s;

            const actualDst =
              ((d as HTMLElement).closest(
                '[draggable="true"]',
              ) as HTMLElement) || d;

            const dataTransfer = new DataTransfer();

            const dataStore: Record<string, string> = {};

            Object.defineProperty(dataTransfer, "setData", {
              value: (type: string, val: string) => {
                dataStore[type] = val;
              },
            });

            Object.defineProperty(dataTransfer, "getData", {
              value: (type: string) => dataStore[type],
            });

            Object.defineProperty(dataTransfer, "effectAllowed", {
              value: "all",

              writable: true,
            });

            Object.defineProperty(dataTransfer, "dropEffect", {
              value: "none",

              writable: true,
            });

            const fire = (node: Element, type: string) => {
              node.dispatchEvent(
                new DragEvent(type, {
                  bubbles: true,

                  cancelable: true,

                  dataTransfer,
                }),
              );
            };

            fire(actualSrc, "dragstart");

            fire(actualDst, "dragenter");

            fire(actualDst, "dragover");

            fire(actualDst, "drop");

            fire(actualSrc, "dragend");
          },

          [srcEl, dstEl],
        );
      }
    } catch (e) {}

    await this.page!.waitForTimeout(1000);
  }

  public async forceClick(
    selector: string,

    elementType?: string,
  ): Promise<void> {
    const cleanSelector = selector.replace(/^['"]|['"]$/g, "");

    if (
      cleanSelector.toLowerCase() === "verify you are human" ||
      cleanSelector.toLowerCase() === "cloudflare"
    ) {
      const cfWrapper = this.page!.locator(
        'iframe[src*="challenges.cloudflare.com"], iframe[title*="Widget containing a Cloudflare security challenge"]',
      ).first();

      await cfWrapper

        .waitFor({ state: "attached", timeout: 10000 })

        .catch(() => {});

      await cfWrapper.scrollIntoViewIfNeeded().catch(() => {});

      const box = await cfWrapper.boundingBox();

      if (box && box.width > 0 && box.height > 0) {
        const clickX = box.x + 30;

        const clickY = box.y + box.height / 2;

        await this.page!.mouse.move(clickX, clickY, { steps: 10 });

        await this.page!.mouse.down();

        await this.page!.waitForTimeout(150);

        await this.page!.mouse.up();

        await this.page!.waitForTimeout(2000);

        return;
      }
    }

    const loc = await this.getLocator(selector, elementType, true, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.click({ force: true });
  }

  public async forceType(
    selector: string,

    value: string,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(selector, elementType, true, false);

    const targetLoc = await this.checkAmbiguity(loc, selector);

    await targetLoc.fill(value, { force: true });
  }

  public async expectVisible(
    selector: string,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, true);

    await loc.first().waitFor({ state: "visible" });
  }

  public async expectText(
    text: string,

    fuzzy: boolean = false,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(text, elementType, false, true, fuzzy);

    await loc.first().waitFor({ state: "visible" });
  }

  public async expectValue(
    selector: string,

    val: string,

    elementType?: string,
  ): Promise<void> {
    const loc = await this.getLocator(selector, elementType, false, true);

    const actual = await loc.first().inputValue();

    if (actual !== val) throw new Error(`Expected ${val}, got ${actual}`);
  }

  public async expectTranscript(expectedText: string): Promise<void> {
    const cleanExpected = expectedText

      .toLowerCase()

      .replace(/[^\w\s]/g, "")

      .replace(/\s+/g, " ")

      .trim();

    const timeout = this.config.timeout || 30000;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const bodyText = await this.page!.locator("body")

        .innerText()

        .catch(() => "");

      const cleanBody = bodyText

        .toLowerCase()

        .replace(/[^\w\s]/g, "")

        .replace(/\s+/g, " ");

      if (cleanBody.includes(cleanExpected)) {
        return; // Assertion passed!
      }

      await this.page!.waitForTimeout(500);
    }

    throw new Error(
      `Transcript Assertion Failed: Expected to see/hear "${expectedText}", but the phrase never appeared in the active layout.`,
    );
  }

  public async getAttribute(
    selector: string,

    attr: string,

    elementType?: string,
  ): Promise<string | null> {
    const loc = await this.getLocator(selector, elementType, true, true);

    return await loc.first().getAttribute(attr);
  }

  private isRawCssSelector(selector: string): boolean {
    if (
      /\b(near|above|under|below|leftOf|rightOf|inside|in)\s+['"]/i.test(
        selector,
      )
    )
      return false;

    if (/^[#\.\[]/.test(selector)) return true;

    if (/^[a-zA-Z0-9]+\s*[\.\#:][a-zA-Z0-9_\-]+/.test(selector)) return true;

    if (/^[a-zA-Z0-9]+\s*\[(?!\d+\])/.test(selector)) return true;

    if (/^(text|css|xpath)=/.test(selector)) return true;

    const htmlTags = [
      "button",

      "nav",

      "form",

      "main",

      "header",

      "footer",

      "section",

      "article",

      "aside",

      "dialog",

      "ul",

      "ol",

      "li",

      "div",

      "span",

      "a",

      "input",

      "table",

      "select",

      "textarea",

      "h1",

      "h2",

      "h3",

      "h4",

      "h5",

      "h6",

      "p",

      "iframe",

      "img",

      "svg",
    ];

    if (htmlTags.includes(selector.toLowerCase())) return true;

    return false;
  }

  private buildHeuristicSelector(
    targetText: string,

    elementType?: string,

    allowStaticText: boolean = false,

    fuzzy: boolean = false,
  ): string {
    const cleanText = targetText.replace(/^['"]|['"]$/g, "");

    const textMatch = fuzzy
      ? `:text("${cleanText}")`
      : `:text-is("${cleanText}")`;

    const optionMatch = fuzzy
      ? `select:has(option:text("${cleanText}"))`
      : `select:has(option:text-is("${cleanText}"))`;

    if (elementType) {
      switch (elementType) {
        case "button":
          return `:is(button:has-text("${cleanText}"), [role="button"]:has-text("${cleanText}"), input[type="submit"][value="${cleanText}" i], input[type="button"][value="${cleanText}" i])`;

        case "link":

        case "a":
          return `:is(a:has-text("${cleanText}"), [role="link"]:has-text("${cleanText}"))`;

        case "input":

        case "field":
          return `:is(input[placeholder="${cleanText}" i], textarea[placeholder="${cleanText}" i], input[aria-label="${cleanText}" i], label:has-text("${cleanText}") input, label:has-text("${cleanText}") textarea)`;

        case "div":
          return `div:has-text("${cleanText}")`;

        case "span":
          return `span:has-text("${cleanText}")`;

        case "image":

        case "img":
          return `img[alt="${cleanText}" i]`;

        case "text":
          return textMatch;
      }
    }

    const attributes = `[placeholder="${cleanText}" i], [aria-label="${cleanText}" i], [title="${cleanText}" i], [name="${cleanText}" i], [value="${cleanText}" i], label:has-text("${cleanText}") input, label:has-text("${cleanText}") textarea, label:has-text("${cleanText}") select, ${optionMatch}`;

    const partialActionable = `button:has-text("${cleanText}"), a:has-text("${cleanText}"), label:has-text("${cleanText}"), [role="button"]:has-text("${cleanText}"), [role="link"]:has-text("${cleanText}"), ${textMatch}`;

    if (allowStaticText)
      return `:is(${attributes}, ${textMatch}, ${partialActionable})`;

    return `:is(${attributes}, ${partialActionable})`;
  }

  private async getLocator(
    rawSelector: string,

    elementType?: string,

    isForceAction: boolean = false,

    isAssertionOrAnchor: boolean = false,

    fuzzy: boolean = false,
  ): Promise<Locator> {
    if (this.isRawCssSelector(rawSelector.trim())) {
      let loc = this.page!.locator(rawSelector);

      if (!isForceAction) loc = loc.filter({ visible: true });

      return loc;
    }

    let target = rawSelector;

    let relation = "";

    let anchor = "";

    const spatialRegex =
      /\b(near|above|under|below|leftOf|rightOf|inside|in)\s+(['"].*?['"])/i;

    const match = rawSelector.match(spatialRegex);

    if (match) {
      target = rawSelector.substring(0, match.index).trim();

      relation = match[1].toLowerCase();

      anchor = match[2];
    }

    let arrayIndex: number | null = null;

    const indexMatch = target.match(/\[(\d+)\]/);

    if (indexMatch) {
      arrayIndex = parseInt(indexMatch[1], 10);

      target = target.replace(indexMatch[0], "").trim();
    }

    const targetClean = target.replace(/^['"]|['"]$/g, "");

    const targetIsRaw = this.isRawCssSelector(targetClean);

    let finalSelector = targetIsRaw
      ? targetClean
      : this.buildHeuristicSelector(
          targetClean,

          elementType,

          isAssertionOrAnchor,

          fuzzy,
        );

    let alternativeSelector = "";

    if (relation && anchor) {
      const anchorClean = anchor.replace(/^['"]|['"]$/g, "");

      const anchorIsRaw = this.isRawCssSelector(anchorClean);

      const anchorSelector = anchorIsRaw
        ? anchorClean
        : this.buildHeuristicSelector(anchorClean, undefined, true, fuzzy);

      const anchorLoc = this.page!.locator(anchorSelector).first();

      try {
        if ((await anchorLoc.count()) > 0) {
          await anchorLoc.scrollIntoViewIfNeeded();
        }
      } catch (e) {}

      switch (relation) {
        case "near":
          finalSelector += `:near(${anchorSelector})`;

          break;

        case "above":
          finalSelector += `:above(${anchorSelector})`;

          break;

        case "under":

        case "below":
          finalSelector += `:below(${anchorSelector})`;

          break;

        case "leftof":
          finalSelector += `:left-of(${anchorSelector})`;

          break;

        case "rightof":
          finalSelector += `:right-of(${anchorSelector})`;

          break;

        case "inside":

        case "in":
          alternativeSelector = `${anchorSelector}:has-text("${targetClean}")`;

          finalSelector = `${anchorSelector} >> ${finalSelector}`;

          break;
      }
    }

    let loc = this.page!.locator(finalSelector);

    if (alternativeSelector) {
      loc = loc.or(this.page!.locator(alternativeSelector));
    }

    let targetLoc = isForceAction ? loc : loc.filter({ visible: true });

    if ((await targetLoc.count()) === 0) {
      await loc

        .first()

        .waitFor({ state: "attached", timeout: 3000 })

        .catch(() => {});

      targetLoc = isForceAction ? loc : loc.filter({ visible: true });

      if ((await loc.count()) > 0 && (await targetLoc.count()) === 0) {
        await loc

          .first()

          .scrollIntoViewIfNeeded()

          .catch(() => {});

        targetLoc = isForceAction ? loc : loc.filter({ visible: true });
      }

      if ((await targetLoc.count()) === 0) {
        const timeout = this.config.timeout || 30000;

        const startTime = Date.now();

        let foundInFrame = false;

        while (Date.now() - startTime < timeout) {
          await this.page!.evaluate(() => window.scrollBy(0, 400)).catch(
            () => {},
          );

          await this.page!.waitForTimeout(150);

          loc = this.page!.locator(finalSelector);

          if (alternativeSelector) {
            loc = loc.or(this.page!.locator(alternativeSelector));
          }

          targetLoc = isForceAction ? loc : loc.filter({ visible: true });

          if ((await targetLoc.count()) > 0) {
            await targetLoc

              .first()

              .scrollIntoViewIfNeeded()

              .catch(() => {});

            break;
          }

          const frames = this.page!.frames();

          for (const frame of frames) {
            if (frame === this.page!.mainFrame()) continue;

            try {
              let frameLoc = frame.locator(finalSelector);

              if (alternativeSelector)
                frameLoc = frameLoc.or(frame.locator(alternativeSelector));

              let frameTargetLoc = isForceAction
                ? frameLoc
                : frameLoc.filter({ visible: true });

              if ((await frameTargetLoc.count()) > 0) {
                targetLoc = frameTargetLoc;

                foundInFrame = true;

                break;
              }
            } catch (e: any) {
              if (e.message.includes("detached")) continue;

              throw e;
            }
          }

          if (foundInFrame) break;
        }
      }
    }

    if (arrayIndex !== null) return targetLoc.nth(arrayIndex);

    return targetLoc;
  }

  public async clearHUD(): Promise<void> {
    await this.page?.evaluate(() => {
      const el = document.getElementById("fs-steps");

      if (el) el.innerHTML = "";
    });
  }

  public async updateHUD(
    id: string,

    text: string,

    status: string,

    error?: string,
  ): Promise<void> {
    if (this.config.headless || !this.page) return;

    await this.page.evaluate(
      ({ id, text, status, error }) => {
        const h = (window as any).FlowstrideHUD;

        if (h) h.updateStep(id, text, status, error);
      },

      { id, text, status, error },
    );
  }

  public async shutdown(videoTargetPath?: string): Promise<void> {
    try {
      const video = this.page?.video();

      if (this.context) {
        await this.context.close();
      }

      if (video && videoTargetPath) {
        await video.saveAs(videoTargetPath);
      }
    } catch (err) {
      console.warn(
        "[WebAdapter]: Warning during browser shutdown or video transfer.",
      );
    } finally {
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
    }
  }
}
