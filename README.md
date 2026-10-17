# Flowstride

**The next-generation, BDD-flavored End-to-End Testing Framework.**

Flowstride OS combines the human-readable structure of Behavior-Driven Development (BDD) with the raw execution power of Playwright. It allows QA engineers and developers to write robust, maintainable UI and API tests using an intuitive domain-specific language (DSL), while providing a rich, interactive React dashboard to monitor, debug, and replay test runs in real time.

[Documentation](https://docs.flowstride.io/)

## Native CI and game testing preview — 1.0.20-rc.2

This is an opt-in preview intended for the npm `next` tag. The default stable
release remains available through `latest`. After the preview is published:

```sh
npm install --save-dev flowstride@next
npx --no-install flowstride install
npx --no-install flowstride run --ci
```

Node.js 22.12.0+ is required; acceptance covers the minimum version and current
Node.js 22/24 on Linux, plus Node.js 24 on macOS. The preview adds native CI
exit codes, JSON/JUnit reports, videos/screenshots, device profiles, explicit
GitHub workflow generation, and supported canvas/Three.js testing APIs.
See [native CI setup](NATIVE_CI.md) and [release notes](RELEASE_NOTES.md).

For this preview, use OSS alone or manually install the matching private Pro
`1.0.15-rc.1` candidate after project dependencies. Normal Cloud login still
serves Pro `1.0.14`; signing in afterward can replace the preview's Pro package,
and that older CLI does not support the new native commands. Cloud reporting
and video-storage defects remain open. Native CI keeps Cloud reporting off by
default. Managed Cloud execution remains retired.

This release qualifies Chromium desktop and emulated phone/landscape profiles
and browser-game fixtures. It does not establish physical-phone, Safari,
Firefox, other game-engine, or complete application-game coverage.

---

## Why Flowstride?

Traditional E2E frameworks force you to choose between highly technical code (which non-developers struggle to read) or rigid low-code tools (which lack flexibility). Flowstride bridges the gap:

- **Plain-English Selectors**: Target elements spatially (`"Submit" near "Cancel"`) or by text, eliminating brittle CSS/XPath dependencies.
- **Unified UI & API Testing**: Execute browser actions and REST/GraphQL API calls within the exact same scenario.
- **Live Visual Dashboard**: Watch your tests run step-by-step, inspect DOM snapshots, trace network activity, and manually replay API requests directly from the UI.
- **Built-in State Management**: Save and inject browser sessions (cookies, local storage) with a single command to bypass repetitive login steps.

---

## Installation & Quick Start

Flowstride requires Node.js 22.12.0 or higher. Use a current patched Node.js 22 or 24 release.

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

## Execution data and Cloud integration

Tests run on your machine or CI runner. Native CI writes reports, screenshots,
videos and attachments to the configured local artifact directory. Interactive
API diagnostics are available in the local dashboard. These outputs can contain
application data or credentials; automatic redaction is not guaranteed.

Cloud login/licensing, FlowMail OTP retrieval and explicitly enabled Cloud
reporting contact their configured services. Native CI leaves Cloud reporting
off unless `cloudSync: true` is explicitly configured. Existing Cloud reporting
and storage limitations remain documented in the preview release notes.

Use test credentials, keep runtime state and artifacts out of source control,
and choose CI artifact access and retention appropriate to the test data.

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
