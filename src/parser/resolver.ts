export class TemplateResolver {
  private readonly pattern = /\{\{(.+?)\}\}/g;

  public resolve(input: string, context: Record<string, any>): string {
    return input.replace(this.pattern, (match, path) => {
      const value = this.getValueFromPath(path.trim(), context);

      if (value === undefined) {
        return match;
      }

      return String(value);
    });
  }

  private getValueFromPath(path: string, context: Record<string, any>): any {
    return path.split(".").reduce((acc, part) => acc && acc[part], context);
  }
}
