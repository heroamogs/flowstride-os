export interface FlowstrideConfig {
    baseUrl?: string;
    timeout: number;
    headless: boolean;
    network?: {
        include?: string[];
        exclude?: string[];
        backgroundPatterns?: string[];
    };
}
export interface SessionDefinition {
    name: string;
    acquire: () => Promise<Record<string, any>>;
    inject?: {
        api?: Record<string, string>;
        ui?: {
            localStorage?: Record<string, string>;
            cookies?: Array<{
                name: string;
                value: string;
                domain: string;
            }>;
        };
    };
    refresh?: {
        onStatus: number[];
        action: () => Promise<Record<string, any>>;
    };
}
export interface Scenario {
    name: string;
    steps: any[];
}
export interface ScenarioResult {
    name: string;
    status: "PASS" | "FAIL" | "ERROR" | "SKIPPED" | "NOT TESTED";
    duration: number;
    error?: string;
}
