export declare class Redactor {
    private static readonly DEFAULT_SENSITIVE_KEYS;
    static redact(data: any, customKeys?: string[]): any;
    static redactUrl(url: string): string;
}
