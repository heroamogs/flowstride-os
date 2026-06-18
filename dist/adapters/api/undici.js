"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiAdapter = void 0;
const undici_1 = require("undici");
class ApiAdapter {
    config;
    globalHeaders = {};
    onUnauthorized;
    lastStatus = null;
    lastBody = null;
    lastHeaders = null;
    lastResponseTime = 0;
    constructor(config) {
        this.config = config;
    }
    setGlobalHeader(name, value) {
        this.globalHeaders[name] = value;
    }
    setUnauthorizedHandler(handler) {
        this.onUnauthorized = handler;
    }
    getState() {
        if (this.lastStatus === null) {
            throw new Error("No API request has been executed yet to extract state from.");
        }
        return {
            status: this.lastStatus,
            body: this.lastBody,
            headers: this.lastHeaders,
            responseTime: this.lastResponseTime,
        };
    }
    resetState() {
        this.lastStatus = null;
        this.lastBody = null;
        this.lastHeaders = null;
        this.lastResponseTime = 0;
    }
    async get(path, headers = []) {
        return this.execute("GET", path, headers);
    }
    async delete(path, headers = []) {
        return this.execute("DELETE", path, headers);
    }
    async post(path, headers, body) {
        return this.execute("POST", path, headers, body);
    }
    async put(path, headers, body) {
        return this.execute("PUT", path, headers, body);
    }
    async patch(path, headers, body) {
        return this.execute("PATCH", path, headers, body);
    }
    async graphql(path, headers, bodyContent) {
        let finalPayload = bodyContent;
        try {
            JSON.parse(bodyContent);
        }
        catch {
            finalPayload = JSON.stringify({ query: bodyContent.trim() });
        }
        const hasContentType = headers.some((h) => h.key.toLowerCase() === "content-type");
        if (!hasContentType)
            headers.push({ key: "Content-Type", value: "application/json" });
        return this.execute("POST", path, headers, finalPayload);
    }
    async execute(method, path, headersArray = [], body) {
        const url = this.config.baseUrl && !path.startsWith("http")
            ? `${this.config.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`
            : path;
        const requestHeaders = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Flowstride/1.0",
            Accept: "application/json, text/plain, */*",
            ...this.globalHeaders,
        };
        let hasContentType = false;
        headersArray.forEach((h) => {
            requestHeaders[h.key] = h.value;
            if (h.key.toLowerCase() === "content-type")
                hasContentType = true;
        });
        if (body && !hasContentType) {
            requestHeaders["Content-Type"] = "application/json";
        }
        const makeRequest = async () => {
            const startTime = Date.now();
            const response = await (0, undici_1.request)(url, {
                method,
                headers: requestHeaders,
                body: body ? body : undefined,
            });
            const responseTime = Date.now() - startTime;
            const text = await response.body.text();
            let parsedBody = text;
            try {
                parsedBody = text ? JSON.parse(text) : null;
            }
            catch { }
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
exports.ApiAdapter = ApiAdapter;
