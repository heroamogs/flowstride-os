import { FlowstrideConfig } from "../../types";
export interface ApiState {
    status: number | null;
    body: any | null;
    headers: Record<string, string | string[] | undefined> | null;
    responseTime: number;
}
export declare class ApiAdapter {
    private config;
    private globalHeaders;
    private onUnauthorized?;
    private lastStatus;
    private lastBody;
    private lastHeaders;
    private lastResponseTime;
    constructor(config: FlowstrideConfig);
    setGlobalHeader(name: string, value: string): void;
    setUnauthorizedHandler(handler: () => Promise<void>): void;
    getState(): ApiState;
    resetState(): void;
    get(path: string, headers?: {
        key: string;
        value: string;
    }[]): Promise<void>;
    delete(path: string, headers?: {
        key: string;
        value: string;
    }[]): Promise<void>;
    post(path: string, headers: {
        key: string;
        value: string;
    }[], body?: string): Promise<void>;
    put(path: string, headers: {
        key: string;
        value: string;
    }[], body?: string): Promise<void>;
    patch(path: string, headers: {
        key: string;
        value: string;
    }[], body?: string): Promise<void>;
    graphql(path: string, headers: {
        key: string;
        value: string;
    }[], bodyContent: string): Promise<void>;
    private execute;
}
