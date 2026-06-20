export enum TokenType {
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
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
}

export class Lexer {
  private position = 0;
  private line = 1;
  private input: string;

  constructor(rawInput: string) {
    this.input = rawInput.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  }

  public tokenise(): Token[] {
    const tokens: Token[] = [];
    let expectingNakedCommand = false;

    while (this.position < this.input.length) {
      const char = this.input[this.position];

      if (char === "\n") {
        this.line++;
        this.position++;
        continue;
      }

      if (
        char === " " ||
        char === "\t" ||
        char === "\r" ||
        char === ";" ||
        char === ","
      ) {
        this.position++;
        continue;
      }

      if (char === "=") {
        tokens.push({ type: TokenType.ASSIGN, value: "=", line: this.line });
        this.position++;
        continue;
      }

      if (char === "{") {
        let jsonStr = "";
        let depth = 0;
        let startLine = this.line;

        while (this.position < this.input.length) {
          const c = this.input[this.position];
          if (c === "{") depth++;
          if (c === "}") depth--;
          if (c === "\n") this.line++;

          jsonStr += c;
          this.position++;

          if (depth === 0) break;
        }

        if (depth > 0) {
          throw new SyntaxError(
            `Lexer Error on line ${startLine}: Unclosed JSON payload bracket '{'`,
          );
        }

        tokens.push({
          type: TokenType.JSON_PAYLOAD,
          value: jsonStr,
          line: startLine,
        });
        continue;
      }

      if (char === '"') {
        expectingNakedCommand = false;

        if (
          this.position + 2 < this.input.length &&
          this.input[this.position + 1] === '"' &&
          this.input[this.position + 2] === '"'
        ) {
          this.position += 3;
          let str = "";

          while (this.position < this.input.length) {
            if (
              this.position + 2 < this.input.length &&
              this.input[this.position] === '"' &&
              this.input[this.position + 1] === '"' &&
              this.input[this.position + 2] === '"'
            ) {
              this.position += 3;
              break;
            }

            if (this.input[this.position] === "\n") {
              this.line++;
            }

            str += this.input[this.position];
            this.position++;
          }

          tokens.push({
            type: TokenType.STRING,
            value: str.trim(),
            line: this.line,
          });
          continue;
        } else {
          let str = "";
          this.position++;
          while (
            this.position < this.input.length &&
            this.input[this.position] !== '"'
          ) {
            str += this.input[this.position];
            this.position++;
          }
          this.position++;
          tokens.push({ type: TokenType.STRING, value: str, line: this.line });
          continue;
        }
      }

      if (/[a-zA-Z_]/.test(char)) {
        let ident = "";

        while (
          this.position < this.input.length &&
          /[a-zA-Z0-9_\-\.]/.test(this.input[this.position])
        ) {
          ident += this.input[this.position];
          this.position++;
        }

        const lowerIdent = ident.toLowerCase();

        if (lowerIdent === "let") {
          tokens.push({ type: TokenType.LET, value: ident, line: this.line });
          continue;
        }

        if (lowerIdent === "feature" || lowerIdent === "scenario") {
          let tempPos = this.position;
          while (
            tempPos < this.input.length &&
            (this.input[tempPos] === " " || this.input[tempPos] === "\t")
          )
            tempPos++;

          if (this.input[tempPos] === '"') {
            throw new SyntaxError(
              `Syntax Error on line ${this.line}: '${ident}' declarations must not use quotation marks.`,
            );
          }
          if (this.input[tempPos] !== ":") {
            throw new SyntaxError(
              `Syntax Error on line ${this.line}: '${ident}' declaration is missing a colon (:).`,
            );
          }

          this.position = tempPos + 1;

          tokens.push({
            type:
              lowerIdent === "feature" ? TokenType.FEATURE : TokenType.SCENARIO,
            value: ident,
            line: this.line,
          });

          let description = "";
          while (
            this.position < this.input.length &&
            (this.input[this.position] === " " ||
              this.input[this.position] === "\t")
          ) {
            this.position++;
          }
          while (
            this.position < this.input.length &&
            this.input[this.position] !== "\n" &&
            this.input[this.position] !== "\r"
          ) {
            description += this.input[this.position];
            this.position++;
          }

          if (!description.trim()) {
            throw new SyntaxError(
              `Syntax Error on line ${this.line}: '${ident}' declaration must have a description.`,
            );
          }

          tokens.push({
            type: TokenType.STRING,
            value: description.trim(),
            line: this.line,
          });
          continue;
        }

        if (expectingNakedCommand) {
          expectingNakedCommand = false;
          if (lowerIdent.startsWith("flow.")) {
            const correctWord = lowerIdent.replace("flow.", "");
            throw new SyntaxError(
              `Syntax Error on line ${this.line}: Do not repeat 'flow.' after 'flow.try'. Use '${correctWord}' instead.`,
            );
          }
          const validNakedCommands = [
            "open",
            "type",
            "click",
            "expect",
            "use",
            "save",
            "upload",
            "set",
            "select",
            "drag",
            "switchTo",
            "close",
            "acceptDialog",
            "rejectDialog",
            "injectAudio",
            "waitForPipeline",
            "forceClick",
            "passcode",
            "forceType",
            "check",
            "uncheck",
            "post",
            "get",
            "put",
            "patch",
            "delete",
            "graphql",
            "autoheal",
            "mail.getotp",
            "extract",
          ];

          if (
            validNakedCommands.map((c) => c.toLowerCase()).includes(lowerIdent)
          ) {
            tokens.push({
              type: TokenType.COMMAND,
              value: ident,
              line: this.line,
            });
            continue;
          } else if (ident.includes(".") && !lowerIdent.startsWith("flow.")) {
            tokens.push({
              type: TokenType.ALIAS_COMMAND,
              value: ident,
              line: this.line,
            });
            continue;
          } else {
            throw new SyntaxError(
              `Syntax Error on line ${this.line}: Expected an action command after 'flow.try', but found "${ident}".`,
            );
          }
        }

        if (["given", "when", "then", "and"].includes(lowerIdent)) {
          let tempPos = this.position;
          while (
            tempPos < this.input.length &&
            (this.input[tempPos] === " " || this.input[tempPos] === "\t")
          )
            tempPos++;

          if (this.input[tempPos] !== '"') {
            throw new SyntaxError(
              `Syntax Error on line ${this.line}: Block '${ident}' must be immediately followed by a description in double quotes ("").`,
            );
          }
          tokens.push({ type: TokenType.BLOCK, value: ident, line: this.line });
        } else if (
          [
            "flow.open",
            "flow.type",
            "flow.click",
            "flow.expect",
            "flow.use",
            "flow.save",
            "flow.upload",
            "flow.set",
            "flow.select",
            "flow.drag",
            "flow.switchTo",
            "flow.close",
            "flow.acceptDialog",
            "flow.rejectDialog",
            "flow.injectAudio",
            "flow.waitForPipeline",
            "flow.forceClick",
            "flow.passcode",
            "flow.try",
            "flow.forceType",
            "flow.check",
            "flow.uncheck",
            "flow.post",
            "flow.get",
            "flow.put",
            "flow.patch",
            "flow.delete",
            "flow.graphql",
            "flow.autoheal",
            "flow.mail.getotp",
            "flow.extract",
          ]
            .map((c) => c.toLowerCase())
            .includes(lowerIdent)
        ) {
          tokens.push({
            type: TokenType.COMMAND,
            value: ident,
            line: this.line,
          });
          if (lowerIdent === "flow.try") expectingNakedCommand = true;
        } else if (
          [
            "text",
            "visible",
            "value",
            "session",
            "persist",
            "attribute",
            "transcript",
            "contains",
            "placeholder",
            "status",
            "responsetime",
            "reqbody",
            "resbody",
            "reqheader",
            "resheader",
            "cookie",
            "global",
          ].includes(lowerIdent)
        ) {
          tokens.push({
            type: TokenType.MODIFIER,
            value: ident,
            line: this.line,
          });
        } else if (
          [
            "button",
            "link",
            "a",
            "input",
            "field",
            "div",
            "span",
            "image",
            "img",
          ].includes(lowerIdent)
        ) {
          tokens.push({
            type: TokenType.ELEMENT,
            value: ident,
            line: this.line,
          });
        } else if (
          [
            "near",
            "above",
            "under",
            "below",
            "leftof",
            "rightof",
            "inside",
            "in",
            "next",
          ].includes(lowerIdent)
        ) {
          tokens.push({
            type: TokenType.SPATIAL,
            value: ident,
            line: this.line,
          });
        } else if (
          [
            "to",
            "from",
            "into",
            "with",
            "as",
            "equals",
            "lessthan",
            "greaterthan",
            "via",
            "to.be",
            "to.not.be",
            "is",
            "is.not",
            "type.of",
            "format",
            "matches",
            "length",
            "length.greaterthan",
            "length.lessthan",
            "includes",
            "does.not.include",
            "has.key",
            "does.not.have.key",
            "is.empty",
            "not.empty",
          ].includes(lowerIdent)
        ) {
          tokens.push({
            type: TokenType.PREPOSITION,
            value: ident,
            line: this.line,
          });
        } else if (ident.includes(".") && !lowerIdent.startsWith("flow.")) {
          tokens.push({
            type: TokenType.ALIAS_COMMAND,
            value: ident,
            line: this.line,
          });
        } else {
          tokens.push({
            type: TokenType.IDENTIFIER,
            value: ident,
            line: this.line,
          });
        }
        continue;
      }

      if (char === "/") {
        if (this.position + 1 < this.input.length) {
          const nextChar = this.input[this.position + 1];

          if (nextChar === "/") {
            while (
              this.position < this.input.length &&
              this.input[this.position] !== "\n"
            ) {
              this.position++;
            }
            continue;
          } else if (nextChar === "*") {
            this.position += 2;
            while (this.position < this.input.length) {
              if (this.input[this.position] === "\n") {
                this.line++;
              }
              if (
                this.input[this.position] === "*" &&
                this.position + 1 < this.input.length &&
                this.input[this.position + 1] === "/"
              ) {
                this.position += 2;
                break;
              }
              this.position++;
            }
            continue;
          }
        }
        throw new SyntaxError(
          `Lexer Error on line ${this.line}: Found a stray "/". Only "//" and "/* */" comments are allowed.`,
        );
      }

      throw new SyntaxError(
        `Lexer Error on line ${this.line}: Unexpected character "${char}"`,
      );
    }

    tokens.push({ type: TokenType.EOF, value: "", line: this.line });
    return tokens;
  }
}
