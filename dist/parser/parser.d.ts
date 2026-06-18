import { Token } from "./lexer";
export interface DeclarationNode {
    alias: string;
    path: string;
    line: number;
}
export interface StepNode {
    id: string;
    blockDescription: string;
    action: string;
    payload: any;
    line: number;
}
export interface ScenarioNode {
    name: string;
    declarations: DeclarationNode[];
    steps: StepNode[];
}
export interface FeatureNode {
    name: string;
    declarations: DeclarationNode[];
    scenarios: ScenarioNode[];
}
export declare class Parser {
    private tokens;
    private position;
    private currentBlockDescription;
    private stepCounter;
    constructor(tokens: Token[]);
    parse(): FeatureNode[];
    private parseDeclaration;
    private parseScenario;
    private parseSmartSelectorPayload;
    private consumeOptionalElement;
    private parseCommand;
    private parseApiModifiers;
    private peek;
    private advance;
    private isAtEnd;
    private consume;
}
