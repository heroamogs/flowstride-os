"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersistentVault = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class PersistentVault {
    vaultPath;
    data = {};
    constructor(projectRoot = process.cwd()) {
        this.vaultPath = path.join(projectRoot, ".flowstride", "vault.json");
        this.initialiseVault();
    }
    initialiseVault() {
        const dir = path.dirname(this.vaultPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(this.vaultPath)) {
            try {
                const rawData = fs.readFileSync(this.vaultPath, "utf8");
                this.data = JSON.parse(rawData);
            }
            catch {
                this.data = {};
            }
        }
    }
    save(key, value) {
        this.data[key] = value;
        this.syncToDisk();
    }
    set(key, value) {
        this.save(key, value);
    }
    get(key) {
        return this.data[key];
    }
    syncToDisk() {
        fs.writeFileSync(this.vaultPath, JSON.stringify(this.data, null, 2));
    }
    clear() {
        this.data = {};
        if (fs.existsSync(this.vaultPath)) {
            fs.unlinkSync(this.vaultPath);
        }
    }
    getAll() {
        return { ...this.data };
    }
}
exports.PersistentVault = PersistentVault;
