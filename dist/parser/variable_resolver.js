"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VariableResolver = void 0;
class VariableResolver {
    store;
    constructor(store) {
        this.store = store;
    }
    resolve(input) {
        if (typeof input === "string") {
            return this.interpolateString(input);
        }
        if (typeof input === "object" && input !== null) {
            const resolvedObj = Array.isArray(input) ? [] : {};
            for (const key in input) {
                resolvedObj[key] = this.resolve(input[key]);
            }
            return resolvedObj;
        }
        return input;
    }
    interpolateString(text) {
        return text.replace(/\{\{(.+?)\}\}/g, (match, varName) => {
            const value = this.store.get(varName.trim());
            if (value === undefined) {
                console.warn(`⚠️  Warning: Variable "{{${varName}}}" not found in store.`);
                return match;
            }
            return String(value);
        });
    }
}
exports.VariableResolver = VariableResolver;
