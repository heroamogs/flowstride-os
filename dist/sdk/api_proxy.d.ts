import { ApiAdapter } from "../adapters/api/undici";
export declare class ApiProxy {
    private adapter;
    constructor(adapter: ApiAdapter);
    private formatHeaders;
    get(url: string, headers?: Record<string, string>): Promise<any>;
    post(url: string, body: any, headers?: Record<string, string>): Promise<any>;
}
