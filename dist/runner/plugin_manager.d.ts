import { FlowstrideConfig } from "../types";
import { ApiProxy } from "../sdk/api_proxy";
import { TemporaryStore } from "./temporary_store";
import { WebAdapter } from "../adapters/web/playwright";
export declare class PluginManager {
    private config;
    private web;
    private store;
    private apiProxy;
    private dbProxy;
    constructor(config: FlowstrideConfig, web: WebAdapter, store: TemporaryStore, apiProxy: ApiProxy);
    execute(actionName: string, args: any, saveAs?: string): Promise<any>;
}
