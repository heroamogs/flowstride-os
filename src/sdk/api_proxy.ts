import { ApiAdapter } from "../adapters/api/undici";

export class ApiProxy {
  constructor(private adapter: ApiAdapter) {}

  private formatHeaders(
    headers?: Record<string, string>,
  ): { key: string; value: string }[] {
    if (!headers) return [];
    return Object.entries(headers).map(([key, value]) => ({ key, value }));
  }

  public async get(
    url: string,
    headers?: Record<string, string>,
  ): Promise<any> {
    const formattedHeaders = this.formatHeaders(headers);

    await this.adapter.get(url, formattedHeaders);

    const state = this.adapter.getState();
    return state.body;
  }

  public async post(
    url: string,
    body: any,
    headers?: Record<string, string>,
  ): Promise<any> {
    const formattedHeaders = this.formatHeaders(headers);

    const stringifiedBody =
      typeof body === "string" ? body : JSON.stringify(body);

    await this.adapter.post(url, formattedHeaders, stringifiedBody);

    const state = this.adapter.getState();
    return state.body;
  }

  public async put(
    url: string,
    body: any,
    headers?: Record<string, string>,
  ): Promise<any> {
    const formattedHeaders = this.formatHeaders(headers);
    const stringifiedBody =
      typeof body === "string" ? body : JSON.stringify(body);
    await this.adapter.put(url, formattedHeaders, stringifiedBody);
    return this.adapter.getState().body;
  }

  public async patch(
    url: string,
    body: any,
    headers?: Record<string, string>,
  ): Promise<any> {
    const formattedHeaders = this.formatHeaders(headers);
    const stringifiedBody =
      typeof body === "string" ? body : JSON.stringify(body);
    await this.adapter.patch(url, formattedHeaders, stringifiedBody);
    return this.adapter.getState().body;
  }

  public async delete(
    url: string,
    headers?: Record<string, string>,
  ): Promise<any> {
    await this.adapter.delete(url, this.formatHeaders(headers));
    return this.adapter.getState().body;
  }
}
