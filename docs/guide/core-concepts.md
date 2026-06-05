# Core Concepts & Philosophy

Before you write your first test, it is critical to understand how Flowstride executes automation. Flowstride is not just a wrapper around Playwright and Undici; it is a **flow first** domain specific language (DSL) designed to force tests to read like actual user journeys, rather than brittle software projects.

Here are the core principles that drive the framework.

---

## 1. Test Anatomy: Feature and Scenario

If you are coming from traditional JavaScript testing frameworks like Jest, Mocha, or Cypress, the outer structure of a `.flow` file will feel very familiar. Flowstride uses `Feature` and `Scenario` blocks to group and define your tests.

- **`Feature`**: Think of this as your `describe` block. It sits at the top of your `.flow` file and defines the high level grouping or the main application component under test (e.g., `Feature: User Authentication`).
- **`Scenario`**: Think of this as your `it` block. It represents a single, independent test case within that feature (e.g., `Scenario: Verify Valid Account Access`).

These structural containers not only organise your test runs but also form the foundation of the management ready reports and testcase tables that Flowstride automatically generates.

---

## 2. The Strict Lifecycle Engine (Given, When, And, Then)

Inside every `Scenario`, Flowstride enforces a strict block order constraint to prevent messy, procedural code. When you write a `.flow` file, the parser engine guarantees that your test follows a definitive resolution path governed by an internal state machine:

- **`Given`**: This block must always be the absolute first step in your scenario. It establishes the initial state, such as navigating to a page, injecting a session, or seeding a database. You cannot start a scenario with any other block.
- **`And`**: This block can comfortably chain after a `Given` block (before a `When` block), or after a `When` block (before a `Then` block) to extend the current context. However, it can never start a scenario, and it can never follow a `Then` block.
- **`When`**: This block must strictly follow a `Given` block (or an `And` block that is attached to a `Given`). It defines the primary action or event the user is taking, such as submitting a form or making a network request.
- **`Then`**: This block must strictly follow a `When` block (or an `And` block that is attached to a `When`). It is reserved exclusively for evaluating the outcome of the action and resolving the scenario. It is the absolute final block of any testcase. Nothing can ever come after the `Then` block.

---

## 3. Conditional And Execution Locks

While Flowstride introduces the `And` block to chain multiple steps together seamlessly, it operates under a strict execution lock system based on its placement context to prevent bad testing practices:

- **The Assertion Lock**: The `And` block is highly restricted. It can exclusively accept assertions (e.g., `flow.expect`) or custom plugins. You cannot use an `And` block to execute standard UI commands like clicking or typing.
- **The Chain Limit**: An `And` block cannot start a scenario, and crucially, it cannot follow a `Then` block. It must only chain onto an active `Given` or `When` block.

---

## 4. The Terminal Lock

Flowstride enforces a safety concept known as the **Terminal Lock** to ensure tests remain concise and focused. The `Then` block represents the absolute end of a testcase.

- **Permanent Lock State**: Once the parser transitions into a `Then` block, the internal state machine locks the scenario permanently. Absolutely nothing can follow it.
- **Terminal Lock Violation**: If you attempt to write an `And` block after a `Then` block, the engine will immediately reject it and throw a Terminal Lock Violation.
- **Validation Placement**: Because the scenario ends strictly at the `Then` stage, you can equally place your final `flow.expect` validations directly inside the `Then` block itself to safely evaluate and terminate the testcase.

---

## 5. Smart Selectors: Text, Intent, and Spatial Mathematics

Traditional frameworks rely heavily on brittle CSS classes or long XPath strings that break every time the UI changes. Flowstride utilises a native **Smart Selector Engine** that prioritises human readable intent, accessibility attributes, and spatial relationships.

When you issue a command like `flow.click button "Login"`, the engine scans the DOM using a strict heuristic approach:

1.  **Accessibility Attributes**: It immediately checks for exact matches against `placeholder`, `aria-label`, `title`, `name`, or `value`.
2.  **Semantic Mappings**: It maps `<label>` text to its corresponding input field or text area.
3.  **Role and Text Fallbacks**: It targets specific actionable roles (e.g., `<button>` or `<a>`) containing the target text.
4.  **Geometric Spatial Selectors**: If a single string isn't enough, you can anchor elements using visual proximity (e.g., `flow.type near "Username"` or `flow.click rightOf "Submit"`).
5.  **CSS / XPath Fallbacks**: Raw CSS paths (`#id` or `.class`) are fully supported but inherently deprioritised over accessible text.

Whenever possible, use plain text or accessibility labels to ensure your tests survive modern UI framework updates.

---

## 6. Unified Web and API Execution

Testing a modern application usually requires two separate tools: one for the user interface and another for the backend data pipes. Flowstride unifies these layers into a single synchronised execution thread.

Within the exact same `.flow` scenario, you can:

- Send a native `flow.post` request via the Undici engine to create a test user in your database.
- Extract or save the API response payload into a local or global variable using the `flow.extract` or `flow.save session` modifier.
- Immediately use a UI command like `flow.type` via the Playwright engine to log that newly created user into the visual interface.

---

## 7. The Persistent Session Vault

Authentication boilerplate is the leading cause of wasted test execution time. Instead of logging into the application before every single scenario, Flowstride introduces the Session Vault.

Using the `flow.save session` and `flow.use session` commands, the framework captures all active browser cookies, local storage, and session storage, merging them safely with your active API headers.

- **In Memory Sessions**: By default, saved sessions are held in memory for rapid sharing across the current test run.
- **Persisted Sessions**: By appending the `persist` keyword (e.g., `flow.save global session "Auth" persist`), Flowstride writes the hybrid state securely to disk. The engine can seamlessly inject this VIP pass into future parallel workers, eliminating repetitive login steps entirely.

## 8. Zero Dependency Native Integrations

In traditional automation, interacting with complex elements often requires stringing together unreliable third party plugins. Flowstride is built with a zero dependency philosophy for complex test scenarios.

The engine natively supports advanced operations directly within the DSL syntax:

- **Cross Domain iFrames**: The engine automatically pierces iFrame boundaries during selector resolution without requiring context switching commands.
- **Email OTP Interception**: Using the `flow.mail.getotp` engine, you can intercept and extract authentication codes from private inboxes natively.
- **Media Stream Injection**: You can mock microphone inputs and bypass physical hardware prompts using `flow.injectAudio`.
- **Native OS File Dialogs**: The `flow.upload` command safely bypasses the operating system file explorer to attach documents directly to the DOM.

These features are treated as first class citizens in the language, ensuring your test suites remain stable without the burden of external package management.
