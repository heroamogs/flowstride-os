export class TemporaryStore {
  private store: Map<string, any> = new Map();

  public set(key: string, value: any): void {
    this.store.set(key, value);
  }

  public get(key: string): any {
    return this.store.get(key);
  }

  public has(key: string): boolean {
    return this.store.has(key);
  }

  public clear(): void {
    this.store.clear();
  }

  public getAll(): Record<string, any> {
    return Object.fromEntries(this.store);
  }
}
