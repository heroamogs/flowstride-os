export interface FlowstrideConfig {
    baseUrl?: string;
    timeout: number;
    headless: boolean;
    defaultDialogBehavior?: 'accept' | 'dismiss';
    urlMapPath?: string;
    network?: {
        include?: string[];
        exclude?: string[];
        backgroundPatterns?: string[];
    };
    security?: {
        sensitiveKeys?: string[];
    };
    pluginsDir?: string;
}
export interface SessionData {
    name: string;
    tokens: Record<string, any>;
    cookies?: any[];
    localStorage?: Record<string, string>;
    createdAt: number;
    lastUsedAt: number;
    persist: boolean;
}
export interface SessionDefinition {
    name: string;
    acquire: () => Promise<Record<string, any>>;
    inject?: {
        api?: {
            headerName: string;
            template: string;
        };
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
        action: (oldTokens: any) => Promise<Record<string, any>>;
    };
}
export interface FlowstrideSDK {
    api: {
        get: (url: string, headers?: Record<string, string>) => Promise<any>;
        post: (url: string, body: any, headers?: Record<string, string>) => Promise<any>;
        put: (url: string, body: any, headers?: Record<string, string>) => Promise<any>;
        delete: (url: string, headers?: Record<string, string>) => Promise<any>;
    };
    ui: {
        click: (selector: string) => Promise<void>;
        type: (selector: string, text: string) => Promise<void>;
        isVisible: (selector: string) => Promise<boolean>;
        getText: (selector: string) => Promise<string>;
    };
    state: {
        get: (key: string) => any;
        set: (key: string, value: any) => void;
    };
    env: {
        get: (key: string) => string | undefined;
    };
    db: {
        connect: (connectionString: string) => any;
    };
    otp: {
        generate: (secret: string) => string;
    };
    log: (message: string) => void;
    expect: {
        visible: (selector: string) => Promise<boolean>;
        equals: (actual: any, expected: any, message?: string) => void;
        contains: (actual: string | any[], expected: any, message?: string) => void;
    };
    utils: {
        sleep: (ms: number) => Promise<void>;
        generateId: (length?: number) => string;
    };
}
export type PluginAction = (flow: FlowstrideSDK, data: any) => Promise<any>;
export interface StepResult {
    id: string;
    screen: string;
    action: string;
    expected: string;
    actual: string;
    status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED' | 'NOT TESTED';
}
export interface Scenario {
    name: string;
    steps: any[];
}
export interface ScenarioResult {
    name: string;
    status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED' | 'NOT TESTED';
    duration: number;
    error?: string;
    steps: StepResult[];
}
