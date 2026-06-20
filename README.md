# Flowstride

**The next-generation, BDD-flavored End-to-End Testing Framework.**

Flowstride OS combines the human-readable structure of Behavior-Driven Development (BDD) with the raw execution power of Playwright. It allows QA engineers and developers to write robust, maintainable UI and API tests using an intuitive domain-specific language (DSL), while providing a rich, interactive React dashboard to monitor, debug, and replay test runs in real time.

---

## Why Flowstride?

Traditional E2E frameworks force you to choose between highly technical code (which non-developers struggle to read) or rigid low-code tools (which lack flexibility). Flowstride bridges the gap:

- **Plain-English Selectors**: Target elements spatially (`"Submit" near "Cancel"`) or by text, eliminating brittle CSS/XPath dependencies.
- **Unified UI & API Testing**: Execute browser actions and REST/GraphQL API calls within the exact same scenario.
- **Live Visual Dashboard**: Watch your tests run step-by-step, inspect DOM snapshots, trace network activity, and manually replay API requests directly from the UI.
- **Built-in State Management**: Save and inject browser sessions (cookies, local storage) with a single command to bypass repetitive login steps.

---

## Installation & Quick Start

Flowstride requires Node.js 18 or higher.

**1. Install globally (or as a dev dependency in your project):**

```bash
npm i flowstride --save-dev
```

**2. Initialize a new Flowstride workspace:**

```bash
npx flowstride init
```

_(This creates the default directory structure (`/flows`, `/reports`, `/plugins`) and generates a `example.flow` sample file.)_

**3. Install VS Code Extension (Highly Recommended):**

To get the best developer experience, including syntax highlighting, auto-completion, and native IDE support for .flow files, install our official VS Code extension directly via the VS Code CLI.

Run the command below:

```bash
code --install-extension flowstride.flowstride-vscode
```

_Alternatively, you can open the Extensions tab in VS Code and search for Flowstride Automation_

**4. Run your first test:**

```bash
npx flowstride run

OR

npx flowstride run flows/example.flow
```

_(This command executes your test while instantly booting up the local Flowstride Dashboard.)_

**5. Login to Flowstride Cloud:**

Authenticate your local project with your Cloud account to unlock Cloud features after signing up at [cloud.flowstride.io](https://cloud.flowstride.io).

```bash
npx flowstride login
```

---

## Privacy & Data Security

Flowstride is designed with a **zero-trust, local-first architecture**. Whether you are testing internal microservices, staging environments, or production APIs, your sensitive data, PHI, and credentials remain strictly on your infrastructure.

### Open Source Core: 100% Local Isolation

The Open Source version of Flowstride operates entirely as an ephemeral, local execution engine.

- **Air-Gapped Execution:** Flowstride does not "phone home." The OS runner executes strictly on your local machine or within your private CI/CD pipeline. There is no external Flowstride database storing your test payloads or network logs.

- **Ephemeral Memory:** Flowstride is inherently stateless. API request headers, response bodies, and DOM snapshots exist only in Node.js RAM during execution. The millisecond the execution process terminates, all memory is wiped.

- **The DevTools Analogy:** Our network interception works natively within Playwright's browser context routing. It is fundamentally identical to opening the Chrome DevTools "Network" tab locally. We do not act as an external Man-In-The-Middle (MITM) proxy.

- **Opt-In Local State:** Artifacts saved to disk—such as execution videos (`.flowstride/mock-cloud/`) or explicitly persisted browser states (`.flowstride/sessions/`)—are written strictly to your local file system to mirror the functionality of tools like Postman. _(Note: We strongly recommend adding `.flowstride/` to your `.gitignore` to prevent accidental credential commits)._

### Flowstride Enterprise: Secure Cloud Telemetry

For teams using Flowstride Enterprise to aggregate multi-flow metrics, we maintain a strict metadata-only boundary.

- **Metadata, Not Payloads:** When cloud sync is active, Flowstride routes only execution metadata to your team's dashboard (e.g., Workspace ID, execution duration, total steps, and pass/fail tallies). **Zero bytes** of request headers, bearer tokens, or JSON bodies are ever transmitted to Flowstride Cloud.

- **Deep Debugging Stays Local:** The rich, interactive visual dashboard, including the JSON explorer and API Replay tools, runs on a dynamic, locally bound port on your machine. You get the UI of a modern cloud app with the security of a local binary.

### CI/CD Leak Protection & Terminal Hygiene

Standard testing frameworks do dump failing API requests, and response bodies directly into the terminal so developers can debug them. In a CI/CD environment, this is a massive security liability, as those secrets are permanently burned into plaintext Jenkins, GitHub Actions, or GitLab CI logs.

Flowstride completely neutralizes this threat by architecturally separating execution output from diagnostic telemetry:

1. **Clean Standard Output (`stdout`):** Flowstride's terminal output only displays high-level, human-readable BDD execution steps (e.g., `✔ Given "User lands on home page"` or `✖ Action Failed`). No JSON request bodies, `cURL` strings, or bearer tokens are ever printed to the terminal console.

2. **WebSocket Isolation:** All sensitive raw network data (payloads, headers, and responses) is emitted _exclusively_ over a secure, ephemeral WebSocket connection directly to the developer's local UI dashboard.

3. **Total Evaporation:** Because CI/CD runners only capture `stdout` text and do not connect to local WebSockets, your highly sensitive diagnostic data simply evaporates the moment the pipeline execution ends. Your pipeline logs remain 100% free of plaintext secrets.

---

## The `.flow` Syntax

Flowstride utilizes a custom `.flow` file extension. It seamlessly pairs descriptive BDD steps (Given, When, And, Then) with direct, executable `flow.` commands.

Here is an example of a standard UI and API flow:

```bash
// Signing up a new user via API call.
Given "User signup via API call"
  flow.post "/api/signup" with reqBody
  """
  {
      "firstName": "Mike",
      "lastName": "Doe",
      "dob": "1995-05-10",
      "sex": "male",
      "email": "user@flowstridemail.com",
      "password": "$randomPassword"
  }
  """
  flow.extract resBody "userId" as "newUserId"
  flow.expect status "201"

// Approving the new user from admin via API call
When "A new signup user is approved by the Admin"
  flow.post "/api/approve" with reqBody
  """
  {
      "userId": "@newUserId"
  }
  """

And "Confirm Status Code is 200"
  flow.expect status "200"

And "Confirm resBody message is successful"
  flow.expect resBody "message" equals "User approved successfully"

And "Confirm user status to be active"
  flow.expect resBody "user.status" equals "active"

// Using the newly registered user credentials to login via the UI
When "User lands on home page"
  flow.open "/login"

And "User clicks on Log in, near Sign Up"
  flow.click "Log in" near "Sign up"

And "User inputs newly created credentials"
  flow.type "Email" "user@flowstridemail.com"
  flow.type "Password" "@randomPassword" // Reusing the random password from API call

Then "Click on Login button"
  flow.click button "Login"

```

---

## Command Reference

### Browser Navigation & Context

| Command    | Example                        | Description                                                      |
| :--------- | :----------------------------- | :--------------------------------------------------------------- |
| `open`     | `flow.open "https://site.com"` | Navigates the browser to the specified URL.                      |
| `switchTo` | `flow.switchTo "next"`         | Switches to a new tab or window by title/URL or relation.        |
| `close`    | `flow.close "Modal Title"`     | Geometrically calculates and clicks the close button of a modal. |

### UI Actions

| Command      | Example                                   | Description                                                     |
| :----------- | :---------------------------------------- | :-------------------------------------------------------------- |
| `click`      | `flow.click "Submit"`                     | Clicks an element based on text, CSS, or spatial relation.      |
| `forceClick` | `flow.forceClick "#hidden-btn"`           | Bypasses Playwright's actionability checks to force a click.    |
| `type`       | `flow.type "Email" "test@test.com"`       | Types value into an input field matching the target.            |
| `passcode`   | `flow.passcode "OTP" "123456"`            | Specifically handles split OTP/Passcode input arrays.           |
| `select`     | `flow.select "Option 1" from "Dropdown"`  | Selects an option from a native select or custom portal.        |
| `check`      | `flow.check "Terms and Conditions"`       | Checks a checkbox or radio button.                              |
| `upload`     | `flow.upload "Avatar" "path/to/file.jpg"` | Uploads a local file to a file input element.                   |
| `drag`       | `flow.drag "Item A" into "Zone B"`        | Drags a source element and drops it into a destination element. |

### Assertions

| Command          | Example                                | Description                                            |
| :--------------- | :------------------------------------- | :----------------------------------------------------- |
| `expect visible` | `flow.expect visible "Success"`        | Asserts an element is attached to the DOM and visible. |
| `expect text`    | `flow.expect text "Error"`             | Asserts specific text is present in the UI.            |
| `expect value`   | `flow.expect value "Username" "admin"` | Asserts the input value of a targeted field.           |

### Session Management

| Command        | Example                    | Description                                                                   |
| :------------- | :------------------------- | :---------------------------------------------------------------------------- |
| `save session` | `flow.save session "Auth"` | Captures current cookies/storage into memory (add `persist` to save to disk). |
| `use session`  | `flow.use session "Auth"`  | Injects previously saved cookies/storage directly into the browser.           |

### API Testing

| Command                        | Example                                       | Description                                                        |
| :----------------------------- | :-------------------------------------------- | :----------------------------------------------------------------- |
| `get`, `post`, `put`, `delete` | `flow.post "/api/users" with reqBody "{...}"` | Executes HTTP requests natively via Undici.                        |
| `extract`                      | `flow.extract resBody "token" as "jwt"`       | Parses API responses and saves data to a local or global variable. |
| `expect status`                | `flow.expect status "200"`                    | Asserts the HTTP status code of the last API call.                 |

_(For a complete list of commands, API assertions, and plugin integration rules, please see the official documentation)._

---

## Interactive Dashboard

Running a `.flow` file automatically boots the Flowstride Dashboard.

- **Live Execution:** Watch tests execute in real-time with an integrated screencast.
- **Step Diagnostics:** Click on any step (Pass or Fail) to view exact execution context, error stack traces, and a DOM snapshot with the target element highlighted.
- **Network Interception:** View all intercepted XHR/Fetch requests. You can click **Replay** on any API log to independently re-execute the request from the Node.js backend natively.
- **Soft Kill & Rerun:** Use the top navigation bar to seamlessly abort running tests, clear state, and restart execution without touching the terminal.

---

## Flowstride OS vs. Enterprise

**Flowstride OS** is free, fully featured, and highly capable for individual developers and standard QA teams.

**Flowstride Enterprise** (`flowstride.io`) unlocks advanced capabilities for massive-scale automation:

- **Distributed Parallel Execution Grid**: Run thousands of tests simultaneously across dynamically spun-up workers.
- **AI Auto-Healing**: Let AI automatically fix broken or outdated selectors during test execution based on DOM analysis.
- **Automated FlowMail (OTP/2FA)**: Fully native email extraction (`flow.getOtp`) to bypass complex 2FA flows.
- **High-Fidelity PDF Exports**: Programmatic, C-suite ready PDF report generation.
- **Cloud Storage & History**: Store all your test runs in the cloud to access and reference them at any time.
- **Native Integrations**: Seamlessly connect your testing workflows directly with Jira and Slack.
- **Massive Team Collaboration**: Scale your operations by connecting with 70+ team members in a shared workspace.

---

## Contributing

We welcome contributions from the community! Whether you are fixing bugs, proposing new features, or improving documentation, please feel free to open an issue or submit a Pull Request.

When submitting a PR, please ensure you test your changes against the core parser (`src/parser/`) and the Playwright web adapter (`src/adapters/web/`).

## License

This project is licensed under the [MIT License](LICENSE).
