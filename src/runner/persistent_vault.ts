import * as fs from "fs";
import * as path from "path";

export class PersistentVault {
  public vaultPath: string;
  public data: Record<string, any> = {};

  constructor(projectRoot: string = process.cwd()) {
    this.vaultPath = path.join(projectRoot, ".flowstride", "vault.json");
    this.initialiseVault();
  }

  public initialiseVault(): void {
    const dir = path.dirname(this.vaultPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.vaultPath)) {
      try {
        const rawData = fs.readFileSync(this.vaultPath, "utf8");
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
    fs.writeFileSync(this.vaultPath, JSON.stringify(this.data, null, 2));
  }

  public clear(): void {
    this.data = {};
    if (fs.existsSync(this.vaultPath)) {
      fs.unlinkSync(this.vaultPath);
    }
  }

  public getAll(): Record<string, any> {
    return { ...this.data };
  }
}
