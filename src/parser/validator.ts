import { StepNode } from "./parser";

export class Validator {
  public static validateStep(step: StepNode): void {
    const { action, payload, line } = step;

    switch (action) {
      case "open":
      case "navigate":
        if (!payload.url) {
          throw new Error(
            `[Line ${line}] Validation Error: 'OPEN' requires a URL string (e.g., OPEN "https://google.com").`,
          );
        }
        break;

      case "type":
        if (!payload.selector || !payload.text) {
          throw new Error(
            `[Line ${line}] Validation Error: 'TYPE' requires both a selector and text (e.g., TYPE "#email" "user@test.com").`,
          );
        }
        break;

      case "click":
        if (!payload.selector) {
          throw new Error(
            `[Line ${line}] Validation Error: 'CLICK' requires a selector.`,
          );
        }
        break;

      case "expect":
        if (payload.type === "visible" && !payload.selector) {
          throw new Error(
            `[Line ${line}] Validation Error: 'EXPECT VISIBLE' requires a selector.`,
          );
        }
        break;

      case "call":
        if (!payload.name) {
          throw new Error(
            `[Line ${line}] Validation Error: 'CALL' requires a plugin name.`,
          );
        }
        break;
    }
  }
}
