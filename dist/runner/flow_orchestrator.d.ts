import { FlowWorker } from "./flow_worker";
import { FlowstrideConfig } from "../types";
export declare class FlowOrchestrator {
    private worker;
    private workerCount;
    private config?;
    private wss;
    private httpServer;
    private globalTestScenarios;
    private stepStatusRegistry;
    constructor(worker: FlowWorker, workerCount?: number, config?: FlowstrideConfig | undefined);
    private forwardToDashboard;
    private executeTestRun;
    start(targetPath: string): Promise<void>;
}
