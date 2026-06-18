"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemporaryStore = void 0;
class TemporaryStore {
    store = new Map();
    set(key, value) {
        this.store.set(key, value);
    }
    get(key) {
        return this.store.get(key);
    }
    has(key) {
        return this.store.has(key);
    }
    clear() {
        this.store.clear();
    }
    getAll() {
        return Object.fromEntries(this.store);
    }
}
exports.TemporaryStore = TemporaryStore;
