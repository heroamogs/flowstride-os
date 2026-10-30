import { ensurePrivateDirectory, privateStatePath, readPrivateState, writePrivateState, removePrivateState } from "../security/privateState";

export class PersistentVault {
  public vaultPath: string;
  public data: Record<string, any> = {};

  constructor(private projectRoot: string = process.cwd()) {
    this.vaultPath = privateStatePath(projectRoot, "vault.json");
    this.initialiseVault();
  }

  public initialiseVault(): void {
    ensurePrivateDirectory(this.projectRoot);
    const rawData = readPrivateState(this.projectRoot, "vault.json");
    if (rawData !== undefined) {
      try {
        this.data = JSON.parse(rawData);
      } catch {
        this.data = {};
      }
    }
  }

  public save(key: string, value: any): void {
    this.data[key] = value;
    this.syncToDisk();
  }

  public set(key: string, value: any): void {
    this.save(key, value);
  }

  public get(key: string): any {
    return this.data[key];
  }

  public syncToDisk(): void {
    writePrivateState(this.projectRoot, "vault.json", JSON.stringify(this.data, null, 2));
  }

  public clear(): void {
    this.data = {};
    removePrivateState(this.projectRoot, "vault.json");
  }

  public getAll(): Record<string, any> {
    return { ...this.data };
  }
}
