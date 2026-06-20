import { WebAdapter } from '../adapters/web/playwright';
import { ApiAdapter } from '../adapters/api/undici';
import { PersistentVault } from '../runner/persistent_vault';
import { SessionDefinition, SessionData } from '../types';

export class SessionManager {
  private activeSession: SessionData | null = null;
  private definitions: Map<string, SessionDefinition> = new Map();

  constructor(
    private web: WebAdapter,
    private api: ApiAdapter,
    private vault: PersistentVault,
  ) {
    this.api.setUnauthorizedHandler(() => this.handleUnauthorized());
  }

  public register(definition: SessionDefinition): void {
    this.definitions.set(definition.name, definition);
  }

  private async handleUnauthorized(): Promise<void> {
    if (!this.activeSession) return;
    const definition = this.definitions.get(this.activeSession.name);
    if (definition?.refresh) {
      const newTokens = await definition.refresh.action(this.activeSession.tokens);
      await this.updateSessionData(this.activeSession.name, newTokens);
    }
  }

  private async updateSessionData(name: string, tokens: any): Promise<void> {
    const data = (this.vault.get(`session_${name}`) as SessionData) || {
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

  public async useSession(name: string): Promise<void> {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`Session "${name}" not defined.`);

    let data = this.vault.get(`session_${name}`) as SessionData | null;

    if (!data) {
      const tokens = await definition.acquire();
      await this.updateSessionData(name, tokens);
    } else {
      this.activeSession = data;
      await this.updateSessionData(name, data.tokens);
    }
  }

  public async saveCurrentState(name: string, persist: boolean): Promise<void> {
    const state = await this.web.getState();
    const data: SessionData = {
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
