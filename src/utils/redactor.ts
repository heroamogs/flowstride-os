export class Redactor {
  private static readonly DEFAULT_SENSITIVE_KEYS = [
    "password",
    "token",
    "accessToken",
    "refreshToken",
    "secret",
    "authorization",
    "bearer",
    "cvv",
    "pin",
  ];

  public static redact(data: any, customKeys: string[] = []): any {
    if (!data || typeof data !== "object") {
      return data;
    }

    const sensitiveKeys = new Set([
      ...this.DEFAULT_SENSITIVE_KEYS,
      ...customKeys,
    ]);

    if (Array.isArray(data)) {
      return data.map((item) => this.redact(item, customKeys));
    }

    const redactedObject: any = {};

    for (const [key, value] of Object.entries(data)) {
      const isSensitive = Array.from(sensitiveKeys).some((sKey) =>
        key.toLowerCase().includes(sKey.toLowerCase()),
      );

      if (isSensitive && value !== null && value !== undefined) {
        redactedObject[key] = "***REDACTED***";
      } else if (typeof value === "object" && value !== null) {
        redactedObject[key] = this.redact(value, customKeys);
      } else {
        redactedObject[key] = value;
      }
    }

    return redactedObject;
  }

  public static redactUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      urlObj.search = "";
      return urlObj.toString();
    } catch {
      return url;
    }
  }
}
