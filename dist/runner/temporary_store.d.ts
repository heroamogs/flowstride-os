export declare class TemporaryStore {
    private store;
    set(key: string, value: any): void;
    get(key: string): any;
    has(key: string): boolean;
    clear(): void;
    getAll(): Record<string, any>;
}
