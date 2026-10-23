# Flowstride

Flowstride OS is an open source framework for browser, API and manual testing. Write readable `.flow` tests, inspect execution in the local dashboard, or run headlessly in CI.

[Documentation](https://docs.flowstride.io/) · [Flowstride Cloud](https://cloud.flowstride.io/)

## Requirements

- Node.js 22.12 or newer.
- Chromium installed through Flowstride for browser tests.

## Get started

Install Flowstride in your project:

```sh
npm install --save-dev flowstride
npx flowstride init
npx flowstride run flows/example.flow
```

`init` creates the project folders and an example flow, and installs Chromium. You can also install the matching browser explicitly:

```sh
npx flowstride install
```

An example flow:

```text
Feature: Home page

Scenario: Show the sign-in form

Given "Open the application"
  flow.open "https://your-application.example/login";

Then "The sign-in button is visible"
  flow.expect visible "Sign in";
```

Replace the URL and assertion with values from your own application.

## Native CI

```sh
npx flowstride run flows --ci
```

CI runs headlessly, returns a nonzero exit code for failed or interrupted execution, and writes JSON and JUnit reports to `flowstride-artifacts` by default. Screenshots, videos and attachments are associated with their run.

To generate a GitHub Actions workflow in an npm project with a committed lockfile:

```sh
npx flowstride ci init github
```

Workflow generation is explicit; package installation does not create a workflow. See [NATIVE_CI.md](./NATIVE_CI.md) for configuration and browser-game testing.

## Local dashboard and manual testing

Interactive runs open a dashboard for execution, per-flow screen history, network inspection and API Replay. The local cURL preview remains redacted; its Copy control copies the original captured request when it is still available in the interactive debugger.

For visual manual test design and execution:

```sh
npx flowstride manual
```

## Flowstride Cloud

Flowstride Cloud users authenticate through the private installation channel:

```sh
npx flowstride login
```

The OS CLI selects a compatible, authorized Cloud engine when available and falls back to OS when the Cloud engine cannot be used. The Cloud engine is distributed privately.

## Test data and artifacts

Flowstride redacts recognized credentials in logs and reports. Redaction cannot guarantee removal of arbitrary application data, and screenshots or videos can contain sensitive information. Use appropriate test data and restrict access to artifacts, persisted sessions and raw requests copied for debugging.

Keep `.flowstride/` and `flowstride-artifacts/` out of version control. CI Cloud reporting is disabled by default and requires explicit configuration and valid credentials.

## License

MIT.
