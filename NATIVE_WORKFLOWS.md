# Core Flowstride workflows

Flowstride can call an API, extract data from its response, use that data in a browser, and verify the application outcome in the same `.flow` test. It also supports table/cell targeting, browser sessions, microphone input and visual manual testing.

The examples below use the normal Flowstride CLI. Their small HTTP server is a local demonstration application; it does not replace the test runner.

## Choose a workflow

| Workflow | What you will do | Availability |
| --- | --- | --- |
| [API + UI in one test](examples/native-workflows/api-and-ui/README.md) | Create a user through an API, sign in through the browser, then verify backend state | OS and Cloud; Chromium, Firefox, WebKit |
| [API + UI + email OTP](examples/native-workflows/api-ui-otp/README.md) | Use FlowMail to retrieve a delivered code and complete application authentication | Cloud; a supported inbox and an application that sends OTP email |
| [iFrames](examples/native-workflows/iframes/README.md) | Find a readable child-frame target, assert inside an explicit frame, and extend an action with a focused plugin | OS and Cloud; Chromium, Firefox, WebKit |
| [Audio-to-text workflows](examples/native-workflows/audio-to-text/README.md) | Inject microphone audio, drive recording controls and check the resulting transcript | OS and Cloud; audio injection requires Chromium |
| [Tables and cells](examples/native-workflows/tables-and-cells/README.md) | Search a table, click a specific row action, extract a cell and reuse its value on another page | OS and Cloud; Chromium, Firefox, WebKit |
| [Variables, reuse and saved sessions](examples/native-workflows/variables-and-reuse/README.md) | Reuse generated/extracted values, understand scope, and restore saved browser state | OS and Cloud; Chromium, Firefox, WebKit |
| [Manual testing](examples/native-workflows/manual-testing/README.md) | Load a design, execute its steps, record defects/results and reopen saved history | OS and Cloud; local Manual Workspace |

Start with the [shared setup](examples/native-workflows/README.md). It installs Flowstride with `npm i flowstride`, copies the examples already included in the package, and starts a loopback-only demo application. No separate starter download is required.

## OS and Cloud

OS works locally without an account. To connect Cloud, run:

```sh
npx flowstride login
```

Use your Cloud developer token when prompted and accept the authenticated engine installation when offered. Cloud has free accounts; availability and usage allowances depend on the workspace feature and plan. Email OTP retrieval uses the Cloud FlowMail service. The other local examples do not need a Cloud service connection.

The public CLI selects a compatible, authorized Cloud engine when available and retains OS fallback. A Cloud-only command still requires its Cloud service prerequisites.

## Reading and running the examples

- `flows/` contains runnable examples for the shared demo application.
- `negative/` contains deliberate failures. Run them individually and expect a nonzero exit code.
- `templates/` contains application-specific workflows. Configure the documented application, credentials and selectors before using them.
- Manual designs are JSON files; a human performs their actions and records the result.

Run the named file from its chapter. Running the whole example tree also discovers intentional failures and service-dependent templates.

Each chapter explains its prerequisites, expected result, negative check and limitations. For browser profiles, native assertions, network mocking, downloads, traces/HAR, accessibility and component testing, use [NATIVE_BROWSER.md](NATIVE_BROWSER.md). For CI, reports and games, use [NATIVE_CI.md](NATIVE_CI.md).

The maintained full reference is at [docs.flowstride.io](https://docs.flowstride.io/).
