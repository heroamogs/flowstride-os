import { TemporaryStore } from "../runner/temporary_store";
export declare class VariableResolver {
    private store;
    constructor(store: TemporaryStore);
    resolve(input: any): any;
    private interpolateString;
}
