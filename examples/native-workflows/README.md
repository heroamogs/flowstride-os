# Run the core workflow examples

These examples accompany [Core Flowstride workflows](../../NATIVE_WORKFLOWS.md). The shared application runs on your computer and stores disposable data in memory. It sends no email and performs no speech recognition. The email-OTP and real-transcription templates explain how to use your own authorized application and services.

## 1. Install through npm

Use Node.js 22.12 or newer. In a new project:

```sh
mkdir flowstride-workflows
cd flowstride-workflows
npm init -y
npm i flowstride
npx flowstride init
npx flowstride install chromium
```

`init` creates the workspace. The explicit browser-install command installs the Chromium build matching the selected engine. The chapters below run their own named example files; any starter file generated under `flows/` is separate.

Copy the examples shipped by the installed package into your project. This keeps fixture edits, sessions and reports in your workspace:

```sh
cp -R node_modules/flowstride/examples/native-workflows workflow-examples
```

On PowerShell, the equivalent copy is:

```powershell
Copy-Item -Recurse node_modules/flowstride/examples/native-workflows workflow-examples
```

Use a fresh `workflow-examples` destination. In an existing project, preserve your configuration and fixtures instead of overwriting them.

## 2. Configure the local application URL

Create a project-root `.env` file, or add these values to the existing file:

```dotenv
BASE_URL=http://127.0.0.1:4107
EXAMPLE_LABEL="Workflow fixture"
```

OS and Cloud load `.env` automatically for a run. `BASE_URL` supplies the base for relative browser and API URLs. You can alternatively set `baseUrl` in `flowstride.config.json`; `BASE_URL` takes precedence.

For example, `flow.open "/orders";` and `flow.post "/api/users" ...` use the same configured application. String values inside `.flow` commands can use `{{env.NAME}}`. General environment-template substitution is not performed throughout the JSON configuration file.

Ensure your project's `.gitignore` includes:

```gitignore
node_modules/
.env
.env.*
!.env.example
.flowstride/
flowstride-artifacts/
```

Share placeholder values in `.env.example`. Keep real credentials in local configuration or CI secrets.

## 3. Start the demo application

In a separate terminal, from the project root:

```sh
node workflow-examples/shared/server.mjs
```

Leave it running. It prints `http://127.0.0.1:4107`; open that address to see the example routes. It listens only on loopback and is a demonstration fixture, not a production authentication service.

If the port is occupied, select another port and update `BASE_URL` to match:

```sh
FLOWSTRIDE_EXAMPLE_PORT=4108 node workflow-examples/shared/server.mjs
```

PowerShell:

```powershell
$env:FLOWSTRIDE_EXAMPLE_PORT = "4108"
node workflow-examples/shared/server.mjs
```

Restarting the app clears its demo users and profile changes. A saved browser session does not restore the app's in-memory database.

## 4. Run a named example

In your other terminal:

```sh
npx flowstride run workflow-examples/api-and-ui/flows/api-and-ui.flow
```

Interactive execution opens the local dashboard. For headless execution, a process exit code and retained evidence:

```sh
npx flowstride run workflow-examples/api-and-ui/flows/api-and-ui.flow --ci
```

A successful run exits with code `0`. Deliberate failures exit nonzero. Read `flowstride-artifacts/summary.json` and `junit.xml`; the summary identifies its unique `run-*` evidence directory. Failed assertions retain their screenshot and video when recording is enabled.

Read an individual step's `error` as well as the suite-level `errors`: an assertion failure can appear on the failed step while the suite-error array is empty.

## 5. Choose browsers or Cloud

```sh
npx flowstride install chromium firefox webkit
npx flowstride run workflow-examples/api-and-ui/flows/api-and-ui.flow --browser firefox --ci
npx flowstride run workflow-examples/api-and-ui/flows/api-and-ui.flow --browser webkit --ci
```

Chromium is the default. Firefox and WebKit run the API/UI, iframe, table and variable examples. Audio-file microphone injection requires Chromium. Use `--headed` to see the test application's browser window during an interactive run.

For Cloud, connect with `npx flowstride login`, accept the authenticated installation when offered, then use the same commands. Private engine hosting and installation details are handled by the authenticated channel.

## CI application startup

Flowstride can own the local application's lifecycle. Stop the manually started demo server first, then use a project configuration such as:

```json
{
  "testDir": "workflow-examples/api-and-ui/flows",
  "timeout": 10000,
  "cloudSync": false,
  "webServer": {
    "command": "node workflow-examples/shared/server.mjs",
    "url": "http://127.0.0.1:4107",
    "timeout": 10000
  }
}
```

Keep `BASE_URL` set in the environment or `.env`. Flowstride starts the configured app, checks readiness, runs the tests and stops the app afterward. It refuses to adopt a readiness URL that is already serving.

Use `npm ci` and matching browser installation on your CI runner. [NATIVE_CI.md](../../NATIVE_CI.md) covers workflow generation and artifact retention. Keep intentional failures and service-dependent templates out of the passing CI target.

## Chapters

- [API + UI](api-and-ui/README.md)
- [API + UI + email OTP](api-ui-otp/README.md)
- [iFrames](iframes/README.md)
- [Audio-to-text](audio-to-text/README.md)
- [Tables and cells](tables-and-cells/README.md)
- [Variables and saved sessions](variables-and-reuse/README.md)
- [Manual testing](manual-testing/README.md)
