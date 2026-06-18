export declare class PersistentVault {
    private vaultPath;
    constructor();
    private ensureVaultExists;
    save(name: string, data: any): void;
    load(name: string): any | null;
    exists(name: string): boolean;
}
