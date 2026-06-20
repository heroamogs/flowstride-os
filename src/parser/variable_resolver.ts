import { TemporaryStore } from "../runner/temporary_store";

export class VariableResolver {
  constructor(private store: TemporaryStore) {}

  public resolve(input: any): any {
    if (typeof input === "string") {
      return this.interpolateString(input);
    }

    if (typeof input === "object" && input !== null) {
      const resolvedObj: any = Array.isArray(input) ? [] : {};
      for (const key in input) {
        resolvedObj[key] = this.resolve(input[key]);
      }
      return resolvedObj;
    }

    return input;
  }

  private interpolateString(text: string): string {
    return text.replace(/\{\{(.+?)\}\}/g, (match, varName) => {
      const value = this.store.get(varName.trim());

      if (value === undefined) {
        console.warn(
          `⚠️  Warning: Variable "{{${varName}}}" not found in store.`,
        );
        return match;
      }

      return String(value);
    });
  }
}
