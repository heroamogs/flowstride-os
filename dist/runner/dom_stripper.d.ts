import { Page } from "playwright";
export declare class DOMStripper {
    static getStrippedHTML(page: Page): Promise<string>;
}
