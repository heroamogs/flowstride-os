export declare class PersistentVault {
    vaultPath: string;
    data: Record<string, any>;
    constructor(projectRoot?: string);
    initialiseVault(): void;
    save(key: string, value: any): void;
    set(key: string, value: any): void;
    get(key: string): any;
    syncToDisk(): void;
    clear(): void;
    getAll(): Record<string, any>;
}
