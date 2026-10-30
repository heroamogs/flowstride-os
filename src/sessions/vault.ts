import { ensurePrivateDirectory, privateStatePath, readPrivateState, writePrivateState, stateSessionFile } from "../security/privateState";

export class PersistentVault {
  private vaultPath: string;

  constructor(private projectRoot: string = process.cwd()) {
    this.vaultPath = privateStatePath(this.projectRoot, "vault");
    this.ensureVaultExists();
  }

  private ensureVaultExists(): void {
    ensurePrivateDirectory(this.projectRoot, "vault");
  }

  public save(name: string, data: any): void {
    writePrivateState(this.projectRoot, "vault/" + stateSessionFile(name), JSON.stringify(data, null, 2));
  }

  public load(name: string): any | null {
    const value = readPrivateState(this.projectRoot, "vault/" + stateSessionFile(name));
    if (value === undefined) return null;

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  public exists(name: string): boolean {
    return readPrivateState(this.projectRoot, "vault/" + stateSessionFile(name)) !== undefined;
  }
}
