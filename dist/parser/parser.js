"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = void 0;
const lexer_1 = require("./lexer");
class Parser {
    tokens;
    position = 0;
    currentBlockDescription = "";
    stepCounter = 1;
    constructor(tokens) {
        this.tokens = tokens;
    }
    parse() {
        const features = [];
        let currentFeatureName = null;
        let currentScenarios = [];
        let featureDeclarations = [];
        while (!this.isAtEnd()) {
            const token = this.peek();
            if (token.type === lexer_1.TokenType.LET) {
                if (!currentFeatureName) {
                    throw new Error(`Line ${token.line}: Scope Violation. Global aliases must be declared inside a Feature block, before Scenarios.`);
                }
                else {
                    featureDeclarations.push(this.parseDeclaration());
                }
            }
            else if (token.type === lexer_1.TokenType.FEATURE) {
                if (currentFeatureName && currentScenarios.length > 0) {
                    features.push({
                        name: currentFeatureName,
                        declarations: featureDeclarations,
                        scenarios: currentScenarios,
                    });
                    currentScenarios = [];
                    featureDeclarations = [];
                }
                this.advance();
                currentFeatureName = this.consume(lexer_1.TokenType.STRING, "Feature must have a description").value;
            }
            else if (token.type === lexer_1.TokenType.SCENARIO) {
                if (!currentFeatureName)
                    throw new Error(`Line ${token.line}: Scenario found before Feature.`);
                currentScenarios.push(this.parseScenario());
            }
            else {
                this.advance();
            }
        }
        if (currentFeatureName && currentScenarios.length > 0) {
            features.push({
                name: currentFeatureName,
                declarations: featureDeclarations,
                scenarios: currentScenarios,
            });
        }
        return features;
    }
    parseDeclaration() {
        const letToken = this.advance();
        const aliasToken = this.consume(lexer_1.TokenType.IDENTIFIER, "Expected alias name after 'let'");
        this.consume(lexer_1.TokenType.ASSIGN, "Expected '=' after alias name");
        const pathToken = this.consume(lexer_1.TokenType.STRING, "Expected plugin file path as string");
        return {
            alias: aliasToken.value,
            path: pathToken.value,
            line: letToken.line,
        };
    }
    parseScenario() {
        this.advance();
        const nameToken = this.consume(lexer_1.TokenType.STRING, "Scenario must have a description");
        const steps = [];
        const declarations = [];
        this.stepCounter = 1;
        let state = "START";
        let hasGiven = false, hasWhen = false, hasAnd = false, hasThen = false;
        let isLocked = false;
        let currentBlockType = "";
        while (!this.isAtEnd() &&
            this.peek().type !== lexer_1.TokenType.SCENARIO &&
            this.peek().type !== lexer_1.TokenType.FEATURE) {
            const token = this.peek();
            if (token.type === lexer_1.TokenType.LET) {
                declarations.push(this.parseDeclaration());
            }
            else if (token.type === lexer_1.TokenType.BLOCK) {
                if (isLocked)
                    throw new Error(`Line ${token.line}: Terminal Lock Violation. No steps allowed after Then.`);
                const blockToken = this.advance();
                const blockType = blockToken.value.toLowerCase();
                let description = this.peek().type === lexer_1.TokenType.STRING ? this.advance().value : "";
                if (blockType === "given") {
                    if (state !== "START")
                        throw new Error(`Line ${token.line}: Given must be first.`);
                    state = "GIVEN";
                    hasGiven = true;
                }
                else if (blockType === "when") {
                    if (state === "START")
                        throw new Error(`Line ${token.line}: When cannot come before Given.`);
                    state = "WHEN";
                    hasWhen = true;
                    isLocked = false;
                }
                else if (blockType === "then") {
                    if (state !== "WHEN")
                        throw new Error(`Line ${token.line}: Then must follow When.`);
                    state = "THEN";
                    hasThen = true;
                    isLocked = true;
                }
                else if (blockType === "and") {
                    if (state === "START")
                        throw new Error(`Line ${token.line}: And cannot start a scenario.`);
                    hasAnd = true;
                }
                currentBlockType = blockType;
                this.currentBlockDescription = description
                    ? `${blockToken.value} "${description}"`
                    : blockToken.value;
            }
            else if (token.type === lexer_1.TokenType.COMMAND ||
                token.type === lexer_1.TokenType.ALIAS_COMMAND) {
                if (isLocked && currentBlockType !== "then") {
                    throw new Error(`Line ${token.line}: Terminal Lock Violation.`);
                }
                const step = this.parseCommand();
                if (currentBlockType === "and" &&
                    step.action !== "expect" &&
                    step.action !== "plugin") {
                    throw new Error(`Line ${token.line}: And blocks are strictly for assertions or custom assertion plugins.`);
                }
                steps.push(step);
            }
            else {
                throw new Error(`Line ${token.line}: Unexpected trailing token "${token.value}". Make sure your command arguments are properly formatted without stray words.`);
            }
        }
        if (!hasGiven || !hasWhen || !hasThen) {
            throw new Error(`Scenario "${nameToken.value}" is missing mandatory blocks.`);
        }
        return { name: nameToken.value, declarations, steps };
    }
    parseSmartSelectorPayload() {
        let selector = "";
        if (!this.isAtEnd() &&
            this.peek().type === lexer_1.TokenType.MODIFIER &&
            this.peek().value.toLowerCase() === "placeholder") {
            const mod = this.advance().value.toLowerCase();
            const value = this.consume(lexer_1.TokenType.STRING, "Selector string expected").value;
            selector = `[${mod}="${value}" i]`;
        }
        else {
            selector = this.consume(lexer_1.TokenType.STRING, "Selector expected").value;
        }
        while (!this.isAtEnd()) {
            const nextToken = this.peek();
            if (nextToken.type === lexer_1.TokenType.SPATIAL) {
                selector += ` ${this.advance().value}`;
                if (!this.isAtEnd() && this.peek().type === lexer_1.TokenType.STRING) {
                    selector += ` "${this.advance().value}"`;
                }
                else {
                    throw new Error(`Line ${nextToken.line}: Expected a string anchor after spatial modifier "${nextToken.value}"`);
                }
                continue;
            }
            if (nextToken.type === lexer_1.TokenType.STRING) {
                const nextStr = nextToken.value;
                if (/^(near|above|under|below|leftOf|rightOf|inside|in):/i.test(nextStr)) {
                    selector += ` "${this.advance().value}"`;
                    continue;
                }
            }
            break;
        }
        return selector;
    }
    consumeOptionalElement(payload) {
        if (!this.isAtEnd() && this.peek().type === lexer_1.TokenType.ELEMENT) {
            payload.elementType = this.advance().value.toLowerCase();
        }
    }
    parseCommand() {
        const commandToken = this.advance();
        if (commandToken.type === lexer_1.TokenType.ALIAS_COMMAND) {
            const parts = commandToken.value.split(".");
            const alias = parts[0];
            const method = parts.slice(1).join(".");
            let dataPayload = {};
            if (!this.isAtEnd() && this.peek().type === lexer_1.TokenType.JSON_PAYLOAD) {
                const jsonToken = this.advance();
                try {
                    dataPayload = JSON.parse(jsonToken.value);
                }
                catch (e) {
                    throw new Error(`Line ${jsonToken.line}: Invalid JSON payload for plugin -> ${e.message}`);
                }
            }
            else if (!this.isAtEnd() && this.peek().type === lexer_1.TokenType.STRING) {
                dataPayload = this.advance().value;
            }
            return {
                id: `S${this.stepCounter++}`,
                blockDescription: this.currentBlockDescription,
                action: "plugin",
                payload: {
                    pluginAlias: alias,
                    pluginMethod: method,
                    data: dataPayload,
                },
                line: commandToken.line,
            };
        }
        let rawAction = commandToken.value.toLowerCase();
        let isOptional = false;
        if (rawAction === "flow.try") {
            isOptional = true;
            const nextToken = this.advance();
            if (nextToken.type !== lexer_1.TokenType.COMMAND &&
                nextToken.type !== lexer_1.TokenType.STRING &&
                nextToken.type !== lexer_1.TokenType.ALIAS_COMMAND) {
                throw new Error(`Expected an action command after flow.try at line ${nextToken.line}`);
            }
            rawAction = nextToken.value.toLowerCase();
        }
        const actionBase = rawAction.startsWith("flow.")
            ? rawAction.replace("flow.", "")
            : rawAction;
        const actionMap = {
            open: "open",
            click: "click",
            forceclick: "forceClick",
            type: "type",
            forcetype: "forceType",
            passcode: "passcode",
            upload: "upload",
            set: "set",
            select: "select",
            drag: "drag",
            switchto: "switchTo",
            close: "close",
            acceptdialog: "acceptDialog",
            rejectdialog: "rejectDialog",
            waitforpipeline: "waitForPipeline",
            injectaudio: "injectAudio",
            use: "use",
            save: "save",
            expect: "expect",
            check: "check",
            uncheck: "uncheck",
            post: "post",
            get: "get",
            put: "put",
            patch: "patch",
            delete: "delete",
            graphql: "graphql",
            autoheal: "autoHeal",
            "mail.getotp": "getOtp",
            extract: "extract",
        };
        const action = actionMap[actionBase] || actionBase;
        let payload = { optional: isOptional };
        switch (action) {
            case "extract":
                const extTargetToken = this.consume(lexer_1.TokenType.MODIFIER, "Expected target after extract");
                const extTarget = extTargetToken.value.toLowerCase();
                let normalizedTarget = extTarget;
                if (extTarget === "resbody")
                    normalizedTarget = "resBody";
                else if (extTarget === "reqbody")
                    normalizedTarget = "reqBody";
                else if (extTarget === "resheader")
                    normalizedTarget = "resHeader";
                else if (extTarget === "reqheader")
                    normalizedTarget = "reqHeader";
                if (!["resBody", "resHeader", "cookie"].includes(normalizedTarget)) {
                    throw new Error(`Line ${extTargetToken.line}: Expected 'resBody', 'resHeader', or 'cookie' after extract`);
                }
                payload.target = normalizedTarget;
                payload.jsonPath = this.consume(lexer_1.TokenType.STRING, "JSONPath or Key expected").value;
                const asToken = this.advance();
                if (asToken.value.toLowerCase() !== "as") {
                    throw new Error(`Line ${asToken.line}: Expected 'as' after extraction target`);
                }
                let isGlobalExtract = false;
                if (!this.isAtEnd() && this.peek().value.toLowerCase() === "global") {
                    this.advance();
                    isGlobalExtract = true;
                }
                payload.isGlobal = isGlobalExtract;
                payload.variableName = this.consume(lexer_1.TokenType.STRING, "Variable name expected").value;
                break;
            case "getOtp":
                payload.email = this.consume(lexer_1.TokenType.STRING, "Email address expected").value;
                const prepToken = this.consume(lexer_1.TokenType.PREPOSITION, 'Expected "into" or "as"');
                if (!["into", "as"].includes(prepToken.value.toLowerCase())) {
                    throw new Error(`Line ${prepToken.line}: Expected 'into' or 'as', found '${prepToken.value}'`);
                }
                let isGlobalOtp = false;
                if (!this.isAtEnd() && this.peek().value.toLowerCase() === "global") {
                    this.advance();
                    isGlobalOtp = true;
                }
                payload.isGlobal = isGlobalOtp;
                payload.variable = this.consume(lexer_1.TokenType.STRING, "Variable name expected").value;
                break;
            case "autoHeal":
                payload.targetStatus = this.consume(lexer_1.TokenType.STRING, 'Expected status code string (e.g. "401")').value;
                const viaToken = this.consume(lexer_1.TokenType.PREPOSITION, 'Expected "via"');
                if (viaToken.value.toLowerCase() !== "via")
                    throw new Error(`Line ${viaToken.line}: Expected 'via'`);
                payload.verb = this.consume(lexer_1.TokenType.COMMAND, "Expected API verb (e.g. POST)").value.toLowerCase();
                payload.url = this.consume(lexer_1.TokenType.STRING, "Endpoint URL expected").value;
                payload.headers = [];
                this.parseApiModifiers(payload);
                break;
            case "post":
            case "get":
            case "put":
            case "patch":
            case "delete":
            case "graphql":
                payload.url = this.consume(lexer_1.TokenType.STRING, "Endpoint URL expected").value;
                payload.headers = [];
                this.parseApiModifiers(payload);
                break;
            case "open":
                payload.url = this.consume(lexer_1.TokenType.STRING, "URL expected").value;
                break;
            case "click":
            case "forceClick":
            case "check":
            case "uncheck":
                this.consumeOptionalElement(payload);
                payload.selector = this.parseSmartSelectorPayload();
                break;
            case "type":
            case "forceType":
            case "passcode":
                this.consumeOptionalElement(payload);
                payload.selector = this.parseSmartSelectorPayload();
                payload.text = this.consume(lexer_1.TokenType.STRING, "Text expected").value;
                break;
            case "upload":
                payload.file = this.consume(lexer_1.TokenType.STRING, "File path expected").value;
                if (!this.isAtEnd() &&
                    this.peek().type === lexer_1.TokenType.PREPOSITION &&
                    this.peek().value.toLowerCase() === "into") {
                    this.advance();
                }
                this.consumeOptionalElement(payload);
                payload.selector = this.parseSmartSelectorPayload();
                break;
            case "set":
                this.consumeOptionalElement(payload);
                payload.selector = this.parseSmartSelectorPayload();
                if (!this.isAtEnd() &&
                    this.peek().type === lexer_1.TokenType.PREPOSITION &&
                    this.peek().value.toLowerCase() === "to") {
                    this.advance();
                }
                payload.value = this.consume(lexer_1.TokenType.STRING, "Value expected").value;
                break;
            case "select":
                payload.option = this.consume(lexer_1.TokenType.STRING, "Option expected").value;
                if (!this.isAtEnd() &&
                    this.peek().type === lexer_1.TokenType.PREPOSITION &&
                    this.peek().value.toLowerCase() === "from") {
                    this.advance();
                }
                this.consumeOptionalElement(payload);
                payload.selector = this.parseSmartSelectorPayload();
                break;
            case "drag":
                this.consumeOptionalElement(payload);
                payload.source = this.parseSmartSelectorPayload();
                if (!this.isAtEnd() &&
                    this.peek().type === lexer_1.TokenType.PREPOSITION &&
                    this.peek().value.toLowerCase() === "into") {
                    this.advance();
                }
                this.consumeOptionalElement(payload);
                payload.destination = this.parseSmartSelectorPayload();
                break;
            case "switchTo":
                if (!this.isAtEnd() &&
                    this.peek().type === lexer_1.TokenType.SPATIAL &&
                    (this.peek().value.toLowerCase() === "next" ||
                        this.peek().value.toLowerCase() === "previous")) {
                    payload.target = this.advance().value;
                }
                else {
                    payload.target = this.consume(lexer_1.TokenType.STRING, "Target tab name expected").value;
                }
                break;
            case "close":
                this.consumeOptionalElement(payload);
                payload.selector = this.parseSmartSelectorPayload();
                break;
            case "acceptDialog":
            case "rejectDialog":
            case "waitForPipeline":
                break;
            case "injectAudio":
                payload.file = this.consume(lexer_1.TokenType.STRING, "Audio file path expected").value;
                break;
            case "use":
            case "save":
                let isGlobalOp = false;
                if (!this.isAtEnd() && this.peek().value.toLowerCase() === "global") {
                    this.advance();
                    isGlobalOp = true;
                }
                this.consume(lexer_1.TokenType.MODIFIER, `${action} session expected`);
                payload.type = "session";
                payload.isGlobal = isGlobalOp;
                payload.name = this.consume(lexer_1.TokenType.STRING, "Session name expected").value;
                if (action === "save" &&
                    !this.isAtEnd() &&
                    this.peek().value.toLowerCase() === "persist") {
                    this.advance();
                    payload.persist = true;
                }
                break;
            case "expect":
                const modToken = this.consume(lexer_1.TokenType.MODIFIER, "Modifier expected");
                let mod = modToken.value.toLowerCase();
                if (mod === "resbody")
                    mod = "resBody";
                if (mod === "resheader")
                    mod = "resHeader";
                payload.type = mod;
                if (mod === "status") {
                    payload.statusCode = this.consume(lexer_1.TokenType.STRING, 'Status code expected (e.g., "200")').value;
                }
                else if (mod === "responsetime") {
                    const conditionToken = this.advance();
                    if (conditionToken.value.toLowerCase() !== "lessthan") {
                        throw new Error(`Line ${modToken.line}: Expected 'lessThan' after responseTime`);
                    }
                    payload.threshold = this.consume(lexer_1.TokenType.STRING, "Time threshold expected").value;
                }
                else if (mod === "resBody" ||
                    mod === "resHeader" ||
                    mod === "cookie") {
                    payload.jsonPath = this.consume(lexer_1.TokenType.STRING, "JSONPath or Key expected").value;
                    payload.assertions = [];
                    const unaryOperators = ["is.empty", "not.empty"];
                    const validConditions = [
                        "equals",
                        "contains",
                        "to.be",
                        "to.not.be",
                        "is",
                        "is.not",
                        "type.of",
                        "format",
                        "matches",
                        "lessthan",
                        "greaterthan",
                        "length",
                        "length.greaterthan",
                        "length.lessthan",
                        "includes",
                        "does.not.include",
                        "has.key",
                        "does.not.have.key",
                        ...unaryOperators,
                    ];
                    while (!this.isAtEnd()) {
                        const nextToken = this.peek();
                        if (nextToken.type !== lexer_1.TokenType.PREPOSITION ||
                            !validConditions.includes(nextToken.value.toLowerCase())) {
                            break;
                        }
                        const conditionToken = this.advance();
                        const condition = conditionToken.value.toLowerCase();
                        let value = "";
                        if (!unaryOperators.includes(condition)) {
                            value = this.consume(lexer_1.TokenType.STRING, `Expected value string after "${condition}"`).value;
                        }
                        payload.assertions.push({ condition, value });
                    }
                    if (payload.assertions.length === 0) {
                        throw new Error(`Line ${modToken.line}: Expected at least one assertion condition (e.g., 'equals', 'type.of') after JSONPath.`);
                    }
                }
                else if (mod === "transcript") {
                    const containsMod = this.consume(lexer_1.TokenType.MODIFIER, 'Expected "contains"');
                    if (containsMod.value.toLowerCase() !== "contains") {
                        throw new Error(`Line ${modToken.line}: Expected 'contains' after transcript`);
                    }
                    payload.text = this.consume(lexer_1.TokenType.STRING, "Expected text value").value;
                }
                else if (mod === "visible" || mod === "text") {
                    if (!this.isAtEnd() &&
                        this.peek().type === lexer_1.TokenType.MODIFIER &&
                        this.peek().value.toLowerCase() === "contains") {
                        this.advance();
                        payload.fuzzy = true;
                    }
                    this.consumeOptionalElement(payload);
                    payload.selector = this.parseSmartSelectorPayload();
                }
                else if (mod === "value" || mod === "attribute") {
                    this.consumeOptionalElement(payload);
                    payload.selector = this.parseSmartSelectorPayload();
                    if (mod === "attribute") {
                        payload.attribute = this.consume(lexer_1.TokenType.STRING, "Attribute name expected").value;
                    }
                    if (!this.isAtEnd() &&
                        this.peek().type === lexer_1.TokenType.MODIFIER &&
                        this.peek().value.toLowerCase() === "contains") {
                        this.advance();
                        payload.fuzzy = true;
                    }
                    payload.text = this.consume(lexer_1.TokenType.STRING, "Expected value expected").value;
                }
                break;
            default:
                throw new Error(`Unknown command: ${action}`);
        }
        return {
            id: `S${this.stepCounter++}`,
            blockDescription: this.currentBlockDescription,
            action,
            payload,
            line: commandToken.line,
        };
    }
    parseApiModifiers(payload) {
        while (!this.isAtEnd()) {
            const nextToken = this.peek();
            const nextVal = nextToken.value.toLowerCase();
            if (nextToken.type === lexer_1.TokenType.PREPOSITION && nextVal === "with") {
                this.advance();
                const targetToken = this.advance();
                const target = targetToken.value.toLowerCase();
                if (target === "reqheader") {
                    const hKey = this.consume(lexer_1.TokenType.STRING, "Header key expected").value;
                    const hVal = this.consume(lexer_1.TokenType.STRING, "Header value expected").value;
                    payload.headers.push({ key: hKey, value: hVal });
                }
                else if (target === "reqbody") {
                    payload.body = this.consume(lexer_1.TokenType.STRING, "Body content expected").value;
                }
                else {
                    throw new Error(`Line ${targetToken.line}: Expected 'reqHeader' or 'reqBody' after 'with'`);
                }
            }
            else {
                break;
            }
        }
    }
    peek() {
        return this.tokens[this.position];
    }
    advance() {
        return this.tokens[this.position++];
    }
    isAtEnd() {
        return this.peek().type === lexer_1.TokenType.EOF;
    }
    consume(type, msg) {
        if (this.peek().type === type)
            return this.advance();
        throw new Error(`${msg} at line ${this.peek().line}`);
    }
}
exports.Parser = Parser;
