export declare enum TokenType {
    FEATURE = "FEATURE",
    SCENARIO = "SCENARIO",
    BLOCK = "BLOCK",
    COMMAND = "COMMAND",
    MODIFIER = "MODIFIER",
    SPATIAL = "SPATIAL",
    PREPOSITION = "PREPOSITION",
    ELEMENT = "ELEMENT",
    STRING = "STRING",
    LET = "LET",
    ASSIGN = "ASSIGN",
    ALIAS_COMMAND = "ALIAS_COMMAND",
    JSON_PAYLOAD = "JSON_PAYLOAD",
    IDENTIFIER = "IDENTIFIER",
    EOF = "EOF"
}
export interface Token {
    type: TokenType;
    value: string;
    line: number;
}
export declare class Lexer {
    private position;
    private line;
    private input;
    constructor(rawInput: string);
    tokenise(): Token[];
}
