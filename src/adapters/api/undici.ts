import { request } from "undici";
import { FlowstrideConfig } from "../../types";

export interface ApiState {
  status: number | null;
  body: any | null;
  headers: Record<string, string | string[] | undefined> | null;
  responseTime: number;
}

export class ApiAdapter {
  private globalHeaders: Record<string, string> = {};
  private onUnauthorized?: () => Promise<void>;

  private lastStatus: number | null = null;
  private lastBody: any | null = null;
  private lastHeaders: Record<string, string | string[] | undefined> | null =
    null;
  private lastResponseTime: number = 0;

  constructor(private config: FlowstrideConfig) {}

  public setGlobalHeader(name: string, value: string): void {
    this.globalHeaders[name] = value;
  }

  public setUnauthorizedHandler(handler: () => Promise<void>): void {
    this.onUnauthorized = handler;
  }

  public getState(): ApiState {
    if (this.lastStatus === null) {
      throw new Error(
        "No API request has been executed yet to extract state from.",
      );
    }
    return {
      status: this.lastStatus,
      body: this.lastBody,
      headers: this.lastHeaders,
      responseTime: this.lastResponseTime,
    };
  }

  public resetState(): void {
    this.lastStatus = null;
    this.lastBody = null;
    this.lastHeaders = null;
    this.lastResponseTime = 0;
  }

  public async get(
    path: string,
    headers: { key: string; value: string }[] = [],
  ) {
    return this.execute("GET", path, headers);
  }

  public async delete(
    path: string,
    headers: { key: string; value: string }[] = [],
  ) {
    return this.execute("DELETE", path, headers);
  }

  public async post(
    path: string,
    headers: { key: string; value: string }[],
    body?: string,
  ) {
    return this.execute("POST", path, headers, body);
  }

  public async put(
    path: string,
    headers: { key: string; value: string }[],
    body?: string,
  ) {
    return this.execute("PUT", path, headers, body);
  }

  public async patch(
    path: string,
    headers: { key: string; value: string }[],
    body?: string,
  ) {
    return this.execute("PATCH", path, headers, body);
  }

  public async graphql(
    path: string,
    headers: { key: string; value: string }[],
    bodyContent: string,
  ) {
    let finalPayload = bodyContent;
    try {
      JSON.parse(bodyContent);
    } catch {
      finalPayload = JSON.stringify({ query: bodyContent.trim() });
    }
    const hasContentType = headers.some(
      (h) => h.key.toLowerCase() === "content-type",
    );
    if (!hasContentType)
      headers.push({ key: "Content-Type", value: "application/json" });
    return this.execute("POST", path, headers, finalPayload);
  }

  private async execute(
    method: any,
    path: string,
    headersArray: { key: string; value: string }[] = [],
    body?: string,
  ): Promise<void> {
    const url =
      this.config.baseUrl && !path.startsWith("http")
        ? `${this.config.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
        : path;

    const requestHeaders: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Flowstride/1.0",
      Accept: "application/json, text/plain, */*",
      ...this.globalHeaders,
    };

    let hasContentType = false;
    headersArray.forEach((h) => {
      requestHeaders[h.key] = h.value;
      if (h.key.toLowerCase() === "content-type") hasContentType = true;
    });

    if (body && !hasContentType) {
      requestHeaders["Content-Type"] = "application/json";
    }

    const makeRequest = async () => {
      const startTime = Date.now();
      const response = await request(url, {
        method,
        headers: requestHeaders,
        body: body ? body : undefined,
      });
      const responseTime = Date.now() - startTime;

      const text = await response.body.text();
      let parsedBody = text;
      try {
        parsedBody = text ? JSON.parse(text) : null;
      } catch {}

      return {
        status: response.statusCode,
        headers: response.headers,
        body: parsedBody,
        responseTime,
      };
    };

    let res = await makeRequest();

    if ((res.status === 401 || res.status === 403) && this.onUnauthorized) {
      await this.onUnauthorized();
      Object.assign(requestHeaders, this.globalHeaders);
      res = await makeRequest();
    }

    this.lastStatus = res.status;
    this.lastHeaders = res.headers;
    this.lastBody = res.body;
    this.lastResponseTime = res.responseTime;
  }
}
