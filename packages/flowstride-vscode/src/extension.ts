import * as vscode from 'vscode';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('flowstride');

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowstride.runTest', (uri?: vscode.Uri) => {
      const fileUri = uri || vscode.window.activeTextEditor?.document.uri;

      if (!fileUri) {
        vscode.window.showErrorMessage('No Flowstride file active.');
        return;
      }

      const terminal =
        vscode.window.terminals.find((t) => t.name === 'Flowstride') ||
        vscode.window.createTerminal('Flowstride');
      terminal.show();

      terminal.sendText(`npx flowstride run "${fileUri.fsPath}"`);
    }),
  );

  const completionCommands = [
    'open',
    'type',
    'click',
    'expect',
    'use',
    'save',
    'upload',
    'set',
    'select',
    'drag',
    'switchto',
    'close',
    'acceptdialog',
    'rejectdialog',
    'injectaudio',
    'waitforpipeline',
    'forceclick',
    'forcetype',
    'passcode',
    'check',
    'uncheck',
    'post',
    'get',
    'put',
    'patch',
    'delete',
    'graphql',
    'autoheal',
    'mail.getotp',
    'extract',
    'try',
  ];

  const dataGenerators = [
    { label: '$uuid', description: 'e.g., 123e4567-e89b-12d3-a456-426614174000' },
    { label: '$timestamp', description: 'e.g., 1678886400' },
    { label: '$isoTimestamp', description: 'e.g., 2026-06-02T11:30:00.000Z' },
    { label: '$randomInt', description: 'e.g., 48291' },
    { label: '$randomNumber', description: 'e.g., 847291' },
    { label: '$randomString', description: 'e.g., a1b2c3d4' },
    { label: '$randomAlpha', description: 'e.g., abcdef' },
    { label: '$randomAlphaNumeric', description: 'e.g., a1b2c3d4' },
    { label: '$randomFirstName', description: 'e.g., Jane' },
    { label: '$randomLastName', description: 'e.g., Doe' },
    { label: '$randomFullName', description: 'e.g., Jane Doe' },
    { label: '$randomUsername', description: 'e.g., jane_flow_12345' },
    { label: '$randomDisplayName', description: 'e.g., Jane D.' },
    { label: '$randomJobTitle', description: 'e.g., Software Engineer' },
    { label: '$randomEmail', description: 'e.g., flow_12345@domain.com' },
    { label: '$randomPhone', description: 'e.g., +14155552671' },
    { label: '$randomPhoneNG', description: 'e.g., 08012345678' },
    { label: '$randomDomain', description: 'e.g., flowstridemail.com' },
    { label: '$randomPassword', description: 'e.g., P@ssWord123!' },
    { label: '$randomOtp', description: 'e.g., 123456' },
    { label: '$randomPin', description: 'e.g., 1234' },
    { label: '$randomToken', description: 'e.g., aB3dE5fG...' },
    { label: '$randomCountry', description: 'e.g., Nigeria' },
    { label: '$randomState', description: 'e.g., Lagos' },
    { label: '$randomCity', description: 'e.g., Ikeja' },
    { label: '$randomStreet', description: 'e.g., 42 Admiralty Way' },
    { label: '$randomAddress', description: 'e.g., 42 Admiralty Way, Ikeja' },
    { label: '$randomZipCode', description: 'e.g., 10021' },
    { label: '$today', description: 'e.g., 2026-06-02' },
    { label: '$tomorrow', description: 'e.g., 2026-06-03' },
    { label: '$yesterday', description: 'e.g., 2026-06-01' },
    { label: '$currentYear', description: 'e.g., 2026' },
    { label: '$currentMonth', description: 'e.g., 06' },
    { label: '$randomCompany', description: 'e.g., Acme Corp' },
    { label: '$randomAmount', description: 'e.g., 1500.50' },
    { label: '$randomCurrency', description: 'e.g., USD' },
    { label: '$randomTransactionId', description: 'e.g., TXN-A1B2C3D4' },
    { label: '$maliciousString', description: 'e.g., <script>alert(1)</script>' },
    { label: '$invalidEmail', description: 'e.g., plainaddress' },
    { label: '$overflowString', description: 'e.g., aaaaaaaaaaa...' },
    { label: '$specialChars', description: 'e.g., !@#$%^&*()' },
    { label: '$runId', description: 'e.g., RUN-a1b2c3' },
    { label: '$workerId', description: 'e.g., worker-1' },
    { label: '$randomPair[Country]', description: 'Generates a correlated Country' },
    { label: '$randomPair[State]', description: 'Generates a correlated State' },
    { label: '$randomPair[City]', description: 'Generates a correlated City' },
  ];

  // --- UNIFIED PROVIDER: Handles flow., $, {, and @ cleanly ---
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'flow',
      {
        provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
          const linePrefix = document.lineAt(position).text.substr(0, position.character);
          const items: vscode.CompletionItem[] = [];

          // 1. Actions (flow.)
          if (linePrefix.endsWith('flow.')) {
            completionCommands.forEach((cmd) => {
              const item = new vscode.CompletionItem(cmd, vscode.CompletionItemKind.Method);
              item.detail = 'Flowstride command';
              items.push(item);
            });
            return items;
          }

          // 2. Data Generators & Memory Scanner
          const genMatch = linePrefix.match(/([$@{])([A-Za-z0-9_\[\]]*)$/);
          if (genMatch) {
            const prefixChar = genMatch[1];

            if (prefixChar === '$' || prefixChar === '{') {
              dataGenerators.forEach((gen) => {
                const item = new vscode.CompletionItem(
                  gen.label,
                  vscode.CompletionItemKind.Variable,
                );
                item.detail = 'Flowstride Data Generator';
                item.documentation = new vscode.MarkdownString(`*${gen.description}*`);
                item.sortText = '0000' + gen.label;

                if (prefixChar === '{') {
                  item.insertText = `{${gen.label}}`;
                }

                items.push(item);
              });
            }

            if (prefixChar === '@') {
              const documentText = document.getText();
              const usedGenerators = documentText.match(/\$[A-Za-z0-9_\[\]]+/g) || [];
              const usedVariables = documentText.match(/@[A-Za-z0-9_]+/g) || [];
              const allUsed = [...new Set([...usedGenerators, ...usedVariables])];

              allUsed.forEach((val) => {
                const cleanName = val.replace(/^[$@]/, '');
                const labelText = `@${cleanName}`;
                const item = new vscode.CompletionItem(
                  labelText,
                  vscode.CompletionItemKind.Reference,
                );
                item.detail = 'Previously used in this file';
                item.sortText = '0001' + labelText;
                items.push(item);
              });
            }
            return items;
          }

          return undefined;
        },
      },
      '.',
      '$',
      '{',
      '@', // Master triggers
    ),
  );

  // --- NATIVE AUTO-FORMATTER & SEMICOLON INJECTOR ---
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('flow', {
      provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const lines = document.getText().split('\n');

        let inDocString = false;
        let currentIndent = '';

        for (let i = 0; i < lines.length; i++) {
          const rawLine = lines[i];
          let line = rawLine.trim();

          // 1. Skip formatting inside multiline strings """
          if (line.includes('"""')) {
            const count = (line.match(/"""/g) || []).length;
            if (count % 2 !== 0) {
              inDocString = !inDocString;
            }
            if (inDocString || count > 0) continue;
          }
          if (inDocString) continue;

          // 2. Clean up blank lines
          if (!line) {
            if (rawLine.length > 0) {
              edits.push(vscode.TextEdit.replace(document.lineAt(i).range, ''));
            }
            continue;
          }

          // 3. Determine semantic indentation level
          if (line.toLowerCase().startsWith('feature:') || line.toLowerCase().startsWith('let ')) {
            currentIndent = '';
          } else if (line.toLowerCase().startsWith('scenario:')) {
            currentIndent = '  ';
          } else if (/^(given|when|then|and)\b/i.test(line)) {
            currentIndent = '    ';
          } else if (
            line.toLowerCase().startsWith('flow.') ||
            line.match(/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+/)
          ) {
            currentIndent = '      ';

            // 4. Inject semicolon at the end of execution scripts if missing
            if (!line.endsWith(';')) {
              line += ';';
            }
          } else if (line.startsWith('//') || line.startsWith('/*')) {
            // Keep comments aligned with whatever the current scope is
          } else {
            currentIndent = '      ';
          }

          const formattedLine = currentIndent + line;

          // Only push an edit if the line actually needs changing
          if (rawLine !== formattedLine) {
            edits.push(vscode.TextEdit.replace(document.lineAt(i).range, formattedLine));
          }
        }
        return edits;
      },
    }),
  );

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => updateDiagnostics(e.document)),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => updateDiagnostics(doc)),
  );
}

function updateDiagnostics(document: vscode.TextDocument) {
  if (document.languageId !== 'flow') {
    return;
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();
  const lines = text.split('\n');

  let inDocString = false;
  let jsonDepth = 0;

  const validCommands = [
    'open',
    'type',
    'click',
    'expect',
    'use',
    'save',
    'upload',
    'set',
    'select',
    'drag',
    'switchto',
    'close',
    'acceptdialog',
    'rejectdialog',
    'injectaudio',
    'waitforpipeline',
    'forceclick',
    'forcetype',
    'passcode',
    'check',
    'uncheck',
    'post',
    'get',
    'put',
    'patch',
    'delete',
    'graphql',
    'autoheal',
    'mail.getotp',
    'extract',
    'try',
  ];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line || line.startsWith('//') || line.startsWith('/*')) {
      continue;
    }

    if (line.includes('"""')) {
      const count = (line.match(/"""/g) || []).length;
      if (count % 2 !== 0) {
        inDocString = !inDocString;
      }
      continue;
    }
    if (inDocString) continue;

    const previousDepth = jsonDepth;
    jsonDepth += (line.match(/\{/g) || []).length;
    jsonDepth -= (line.match(/\}/g) || []).length;

    if (previousDepth > 0 || line.startsWith('{') || line.startsWith('}')) {
      continue;
    }

    const stepMatch = line.match(/^(Given|When|Then|And)\b/i);
    if (stepMatch) {
      if (!line.includes('"') && !line.includes("'")) {
        const range = new vscode.Range(i, 0, i, rawLine.length);
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Flowstride Syntax Error: '${stepMatch[1]}' must be followed by a description wrapped in quotation marks.`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
      }
      continue;
    }

    const structureMatch = line.match(/^(Feature|Scenario)\b/i);
    if (structureMatch) {
      if (line.includes('"') || line.includes("'")) {
        const range = new vscode.Range(i, 0, i, rawLine.length);
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Flowstride Syntax Error: '${structureMatch[1]}' declarations must not use quotation marks.`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
      } else if (!line.includes(':')) {
        const range = new vscode.Range(i, 0, i, rawLine.length);
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Flowstride Syntax Error: '${structureMatch[1]}' declaration is missing a colon (:).`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
      }
      continue;
    }

    if (line.toLowerCase().startsWith('flow.try')) {
      const parts = line.split(/\s+/);
      if (parts.length === 1) {
        const range = new vscode.Range(i, 0, i, rawLine.length);
        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Flowstride Syntax Error: 'flow.try' must be followed by an action command (e.g., flow.try click "Submit").`,
            vscode.DiagnosticSeverity.Error,
          ),
        );
      }
      continue;
    }

    const firstWordMatch = line.match(/^([a-zA-Z0-9_.-]+)/);
    if (firstWordMatch) {
      const firstWord = firstWordMatch[1];
      const lowerWord = firstWord.toLowerCase();

      const isStructure = ['feature', 'scenario', 'let'].includes(lowerWord);
      const isNakedCommand = validCommands.includes(lowerWord);
      const isFlowCommand =
        lowerWord.startsWith('flow.') && validCommands.includes(lowerWord.replace('flow.', ''));
      const isPlugin = lowerWord.includes('.') && !lowerWord.startsWith('flow.');

      if (!isStructure && !isNakedCommand && !isFlowCommand && !isPlugin) {
        const startPos = rawLine.indexOf(firstWord);
        const range = new vscode.Range(i, startPos, i, startPos + firstWord.length);

        if (lowerWord.startsWith('flow.')) {
          diagnostics.push(
            new vscode.Diagnostic(
              range,
              `Flowstride Syntax Error: '${firstWord}' is not a recognized Flowstride command.`,
              vscode.DiagnosticSeverity.Error,
            ),
          );
        } else {
          diagnostics.push(
            new vscode.Diagnostic(
              range,
              `Flowstride Syntax Error: Unknown command or keyword '${firstWord}'.`,
              vscode.DiagnosticSeverity.Error,
            ),
          );
        }
      }
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}

export function deactivate() {
  diagnosticCollection.clear();
}
