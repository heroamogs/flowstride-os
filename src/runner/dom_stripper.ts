import { Page } from "playwright";

export class DOMStripper {
  public static async getStrippedHTML(page: Page): Promise<string> {
    try {
      const strippedHtml = await page.evaluate(() => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;

        const junkTags = [
          "script",
          "style",
          "svg",
          "path",
          "noscript",
          "meta",
          "link",
          "iframe",
          "canvas",
          "video",
          "audio",
          "picture",
        ];

        junkTags.forEach((tag) => {
          const elements = clone.querySelectorAll(tag);
          elements.forEach((el) => el.remove());
        });

        const hiddenElements = clone.querySelectorAll(
          '[hidden], [aria-hidden="true"], [style*="display: none"], [style*="visibility: hidden"]',
        );
        hiddenElements.forEach((el) => el.remove());

        const removeComments = (node: Node) => {
          for (let i = node.childNodes.length - 1; i >= 0; i--) {
            const child = node.childNodes[i];
            if (child.nodeType === Node.COMMENT_NODE) {
              child.remove();
            } else if (child.nodeType === Node.ELEMENT_NODE) {
              removeComments(child);
            }
          }
        };
        removeComments(clone);

        const allElements = clone.querySelectorAll("*");
        allElements.forEach((el) => {
          if (el.tagName.toLowerCase() === "img") {
            el.removeAttribute("src");
          }
        });

        let rawHtml = clone.outerHTML;

        rawHtml = rawHtml.replace(/[\n\r\t]+/g, " ");
        rawHtml = rawHtml.replace(/\s{2,}/g, " ");
        rawHtml = rawHtml.replace(/>\s+</g, "><");

        return rawHtml.trim();
      });

      return strippedHtml;
    } catch (error) {
      console.warn("[DOM Stripper] Failed to extract minified DOM:", error);
      return "<html><body>[Error: Could not extract DOM state]</body></html>";
    }
  }
}
