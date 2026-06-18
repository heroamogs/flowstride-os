"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TemplateResolver = void 0;
class TemplateResolver {
    pattern = /\{\{(.+?)\}\}/g;
    resolve(input, context) {
        return input.replace(this.pattern, (match, path) => {
            const value = this.getValueFromPath(path.trim(), context);
            if (value === undefined) {
                return match;
            }
            return String(value);
        });
    }
    getValueFromPath(path, context) {
        return path.split(".").reduce((acc, part) => acc && acc[part], context);
    }
}
exports.TemplateResolver = TemplateResolver;
