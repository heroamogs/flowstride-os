"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbProxy = void 0;
class DbProxy {
    connect(connectionString) {
        console.log(`Plugin establishing secure connection to: ${connectionString}`);
        return {
            queryOne: async (sql, params) => {
                console.log(`Executing safe query: ${sql}`);
                return {};
            },
        };
    }
}
exports.DbProxy = DbProxy;
