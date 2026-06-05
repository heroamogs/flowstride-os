# State, Extensibility & CLI Reference

As your test suites grow, you will need to handle complex state management, custom backend logic, and scalable execution configurations. This reference covers Flowstride's advanced features designed for enterprise grade architecture.

---

## 1. The Session Engine (State Management)

The Session Vault allows you to capture the entire hybrid state of the browser (Playwright) and the API client (Undici) simultaneously. This completely eliminates the need to run repetitive login steps across multiple test scenarios.

### Saving a Session

When you save a session, Flowstride extracts all active browser cookies, local storage, session storage, and active API headers into a unified state object.

- **Local Scope**: `flow.save session "Auth"` (Saved in memory for the current `.flow` file; i.e, runs only in the current Scenario block).
- **Global Scope**: `flow.save global session "Auth"` (Saved in memory and shared across all files in the current run; i.e, runs in all the Scenarios in the current Feature block).
- **Disk Persistence**: `flow.save global session "Auth" persist` (Writes the state securely to disk in the `.flowstride/sessions/` directory, allowing it to be injected into completely separate parallel workers; i.e, it can be shared within seperate directories/files within the .flows directory).

### Injecting a Session

To restore a saved state, use the `use` command. The framework will automatically inject the tokens into both the API client headers and the browser storage before navigating.

**Example:**

```bash
Given "Inject the previously saved VIP session";
  flow.use global session "Auth";
```

---

## 2. Plugin Invocation (Extensibility)

While Flowstride aims for zero dependency native integrations, you may occasionally need to execute custom TypeScript or JavaScript logic (e.g., generating a proprietary cryptographic hash for your specific backend).

Flowstride supports a clean `alias.method` token notation to trigger external wrapper functions seamlessly. To use a plugin, you must first register its file path using the `let` keyword. The parser enforces strict scoping rules for these declarations.

### Global Scope (Feature Level)

To make a plugin available to every scenario within the file, declare it immediately after the `Feature` block, before any `Scenario` begins.

```bash
Feature: User Authentication;

let myCrypto = "plugins/hashGenerator.ts";

Scenario: Verify Admin Login;
```

### Local Scope (Scenario Level)

To restrict a plugin to a single, specific testcase, declare it inside the `Scenario` block.

```bash
Scenario: Verify Admin Login;

let myCrypto = "plugins/hashGenerator.ts";
```

### Invoking the Plugin Method

Once registered, you can call any exported method from that file directly in your steps, passing either strings or raw JSON payloads as arguments.

**Example:**

```bash
And "Generate a custom authentication hash";
  myCrypto.generateToken { "role": "admin", "accessLevel": 5 };
```

---

## 3. CLI & Orchestrator Reference

Flowstride does not just run tests; it spins up a dedicated local orchestrator to sync visual telemetry, network traffic, and DOM states in real time.

### Server Port Mappings

- **Port 4321**: The Flowstride Orchestrator. It manages the WebSocket connections, coordinates parallel workers, and streams chunked video data.
- **Port 5173**: The Interactive Dashboard. This is the UI where you monitor live execution logs and inspect the cURL synthesiser.

### Internal Video Extraction Routing

During execution, Flowstride automatically records high fidelity video buffers of the browser interactions.

- Videos are safely encoded and stored in the `.flowstride/mock-cloud/` directory upon test completion.
- If you review a test trace in the Dashboard, the Orchestrator uses HTTP range requests on Port 4321 to seamlessly stream these `.webm` files directly into your browser without requiring external hosting.

### Management Ready Report Compilers

Flowstride features a native PDF generator built into the Orchestrator.

When you trigger a report export from the Dashboard, the engine programmatically compiles a pristine, multi page A4 PDF document containing your complete "Test Case Log". It maps every executed block to its expected and actual result, providing immediate, audit ready compliance documentation.

### Pro Mode (Parallel Execution)

By default, tests run sequentially. To drastically reduce execution time on large test suites, you can configure the CLI to distribute `.flow` files across multiple isolated workers. Flowstride safely silences the terminal noise from parallel threads, only emitting clean pass or fail summaries to keep your CI/CD logs readable.
