import { WebAdapter } from '../adapters/web/playwright';
import { ApiAdapter } from '../adapters/api/undici';
import { PersistentVault } from '../runner/persistent_vault';
import { SessionDefinition } from '../types';
export declare class SessionManager {
    private web;
    private api;
    private vault;
    private activeSession;
    private definitions;
    constructor(web: WebAdapter, api: ApiAdapter, vault: PersistentVault);
    register(definition: SessionDefinition): void;
    private handleUnauthorized;
    private updateSessionData;
    useSession(name: string): Promise<void>;
    saveCurrentState(name: string, persist: boolean): Promise<void>;
}
