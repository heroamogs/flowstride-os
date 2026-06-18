"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiProxy = void 0;
class ApiProxy {
    adapter;
    constructor(adapter) {
        this.adapter = adapter;
    }
    formatHeaders(headers) {
        if (!headers)
            return [];
        return Object.entries(headers).map(([key, value]) => ({ key, value }));
    }
    async get(url, headers) {
        const formattedHeaders = this.formatHeaders(headers);
        await this.adapter.get(url, formattedHeaders);
        const state = this.adapter.getState();
        return state.body;
    }
    async post(url, body, headers) {
        const formattedHeaders = this.formatHeaders(headers);
        const stringifiedBody = typeof body === "string" ? body : JSON.stringify(body);
        await this.adapter.post(url, formattedHeaders, stringifiedBody);
        const state = this.adapter.getState();
        return state.body;
    }
}
exports.ApiProxy = ApiProxy;
