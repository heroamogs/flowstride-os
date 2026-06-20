import * as fs from "fs";
import * as path from "path";

export class PersistentVault {
  private vaultPath: string;

  constructor() {
    this.vaultPath = path.join(process.cwd(), ".flowstride", "vault");
    this.ensureVaultExists();
  }

  private ensureVaultExists(): void {
    if (!fs.existsSync(this.vaultPath)) {
      fs.mkdirSync(this.vaultPath, { recursive: true });
    }
  }

  public save(name: string, data: any): void {
    const filePath = path.join(this.vaultPath, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  public load(name: string): any | null {
    const filePath = path.join(this.vaultPath, `${name}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  public exists(name: string): boolean {
    return fs.existsSync(path.join(this.vaultPath, `${name}.json`));
  }
}
