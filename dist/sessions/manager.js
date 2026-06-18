"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
class SessionManager {
    web;
    api;
    vault;
    activeSession = null;
    definitions = new Map();
    constructor(web, api, vault) {
        this.web = web;
        this.api = api;
        this.vault = vault;
        this.api.setUnauthorizedHandler(() => this.handleUnauthorized());
    }
    register(definition) {
        this.definitions.set(definition.name, definition);
    }
    async handleUnauthorized() {
        if (!this.activeSession)
            return;
        const definition = this.definitions.get(this.activeSession.name);
        if (definition?.refresh) {
            const newTokens = await definition.refresh.action(this.activeSession.tokens);
            await this.updateSessionData(this.activeSession.name, newTokens);
        }
    }
    async updateSessionData(name, tokens) {
        const data = this.vault.get(`session_${name}`) || {
            name,
            createdAt: Date.now(),
            persist: true,
        };
        data.tokens = tokens;
        data.lastUsedAt = Date.now();
        this.vault.save(`session_${name}`, data);
        this.activeSession = data;
        await this.web.injectStorage(data.cookies, data.localStorage);
        const definition = this.definitions.get(name);
        if (definition?.inject?.api) {
            const { headerName, template } = definition.inject.api;
            const token = tokens.accessToken || tokens.idToken;
            this.api.setGlobalHeader(headerName, template.replace('{{token}}', token));
        }
    }
    async useSession(name) {
        const definition = this.definitions.get(name);
        if (!definition)
            throw new Error(`Session "${name}" not defined.`);
        let data = this.vault.get(`session_${name}`);
        if (!data) {
            const tokens = await definition.acquire();
            await this.updateSessionData(name, tokens);
        }
        else {
            this.activeSession = data;
            await this.updateSessionData(name, data.tokens);
        }
    }
    async saveCurrentState(name, persist) {
        const state = await this.web.getState();
        const data = {
            name,
            tokens: this.activeSession?.tokens || {},
            cookies: state.cookies,
            localStorage: state.localStorage,
            createdAt: Date.now(),
            lastUsedAt: Date.now(),
            persist,
        };
        this.vault.save(`session_${name}`, data);
    }
}
exports.SessionManager = SessionManager;
