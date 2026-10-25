# Native browser workflows

For API/UI composition, email OTP, iframe examples, audio-to-text, tables, variables and manual testing, start with [Core Flowstride workflows](NATIVE_WORKFLOWS.md).

OS and Cloud support these commands directly in `.flow` files. Existing commands, plugins and saved sessions continue to work. Use `flow.<area>.<action>` followed by a JSON object. Unknown actions and options fail explicitly.

Keep both engine installations current when using these features. If an installed Cloud engine lacks the required capability protocol, the public runner warns and uses OS fallback for the run. Existing commands can still use an older compatible Cloud engine; Cloud-only services require a compatible Cloud installation.

## Separate users in one test

A **profile** is an independent browser context: its cookies, local storage, session storage, pages and permissions are separate. The original profile is named `default`. Creating a profile selects it; switching profiles returns to the page that user was using.

```flow
flow.browser.create {
  "name": "customer",
  "options": {
    "locale": "en-GB",
    "colorScheme": "dark"
  }
};
flow.open "/login";
flow.type input "Email" "{{env.CUSTOMER_EMAIL}}";
flow.type input "Password" "{{env.CUSTOMER_PASSWORD}}";
flow.click button "Sign in";
flow.browser.create {
  "name": "admin"
};
flow.open "/admin/login";
flow.browser.use {
  "name": "customer"
};
```

`flow.save session "customer" persist;` still saves a snapshot of the **currently selected** profile. `flow.use session "customer";` still injects a saved snapshot into the current profile. Saving a snapshot does not create another live user. Sequential customer/admin scenarios remain valid without profiles; use profiles when the users must stay independently logged in.

`flow.browser.close` closes a named profile. The `default` profile remains available until file completion. Profiles are reset between files. `flow.switchTo` still selects tabs within the current profile.

## Browser selection and settings

```sh
npx flowstride install chromium firefox webkit
npx flowstride run flows --browser firefox --ci
```

Use `--browser firefox` or `--browser webkit` to select the test engine. The terminal prints the verified engine and version after launch; the dashboard shows **Test browser**, and CI's `summary.json` includes the actual engine for each file. `install` downloads browser binaries and does not open a browser window.

Interactive runs display the dashboard in a separate Firefox or WebKit window when either engine is selected. The dashboard remains in the system default browser for Chromium runs. Test pages run headlessly by default; add `--headed` to see the application's own browser window:

```sh
npx flowstride run flows --browser firefox --headed
npx flowstride run flows --browser webkit --headed
```

CI forces headless execution and opens no dashboard. Firefox and WebKit keep their native user-agent unless you explicitly configure `browserOptions.userAgent`. WebKit is Safari's engine, rather than the installed Safari application.

Chromium remains the default. Browser installation must match the installed Flowstride package. In Linux CI, add `--with-deps` to the install command. Browser support does not mean every operating-system/browser/device combination is qualified. Firefox does not support Playwright's mobile emulation setting; phone profiles use its viewport/touch settings without that flag. Chromium-specific game touch and audio-file injection still require Chromium.

```json
{
  "browser": "chromium",
  "browserOptions": {
    "locale": "en-GB",
    "timezoneId": "Europe/London",
    "colorScheme": "dark",
    "permissions": ["geolocation"],
    "geolocation": {
      "latitude": 6.5244,
      "longitude": 3.3792
    },
    "serviceWorkers": "block"
  }
}
```

Validated settings include viewport/screen, device scale, touch/mobile emulation, locale/timezone, color/contrast/motion, JavaScript, HTTPS handling, CSP bypass, permissions/geolocation, offline mode, headers, HTTP credentials, proxy, downloads, strict selectors, storage state and project-local client certificate paths. Use `browserOptions` for the default profile and `options` in `flow.browser.create` for a separate profile. Secrets belong in environment variables or private local files.

Set `BASE_URL` directly in a project `.env` file when you want a common application URL. String values in native `.flow` command payloads support environment templates. The JSON configuration loader does not generally expand `{{env.NAME}}` throughout arbitrary `browserOptions`; use supported native profile options for command-time credential interpolation.

Runtime commands include `flow.browser.offline` with `value`, `flow.browser.permissions` with `permissions` and optional `origin`, `flow.browser.clearPermissions`, and `flow.browser.geolocation` with latitude/longitude. Recording paths are controlled by evidence settings, rather than arbitrary browser path options. JavaScript logger callbacks are not JSON DSL settings.

## Assertions that wait for a condition

```flow
flow.assert.that {
  "selector": "#order-status",
  "condition": "text",
  "value": "Approved",
  "timeout": 10000
};
flow.assert.that {
  "role": "button",
  "name": "Submit",
  "condition": "enabled"
};
flow.assert.that {
  "selector": ".loading",
  "condition": "visible",
  "not": true
};
```

Choose one CSS/Playwright `selector` or accessible `role` with an optional exact `name`. An optional `frame` selects an iframe. Conditions include:

| Conditions | Expected input |
| --- | --- |
| `visible`, `hidden`, `attached`, `enabled`, `disabled`, `editable`, `checked`, `empty`, `focused`, `inViewport` | No value |
| `text`, `containsText`, `value`, `id`, `accessibleName`, `accessibleDescription` | `value`, or `matches` and optional regex `flags` |
| `values` | Array of selected option values |
| `count` | Nonnegative integer `value` |
| `attribute` | `attribute`; optional expected `value`; omit it to check presence |
| `css`, `property` | `property` and expected `value` |
| `url`, `title` | Expected `value` or regex `matches`; no selector needed |
| `localStorage`, `sessionStorage` | `key` and expected string `value`, or `null` for absence |

Text comparisons normalize whitespace. Assertions retry until `timeout` or the configured default; they do not repeatedly click or repeat requests. Existing `flow.expect` syntax remains supported.

## Mock requests and wait for network events

Use `serviceWorkers: "block"` when mocking an application that registers service workers. Mocking applies to browser traffic in the current profile; it does not intercept `flow.get` or other direct API commands.

```flow
flow.network.route {
  "name": "customer-response",
  "url": "**/api/customer",
  "method": "GET",
  "json": {
    "name": "Documentation Reader"
  },
  "times": 1
};
flow.network.arm {
  "name": "customer-request",
  "url": "**/api/customer",
  "kind": "response"
};
flow.click button "Load customer";
flow.network.wait {
  "name": "customer-request"
};
flow.network.expect {
  "name": "customer-request",
  "status": 200,
  "path": "name",
  "equals": "Documentation Reader"
};
```

**Arm before the trigger, then wait.** This captures fast responses and prevents an unobserved timeout while a click is still finishing. Waiters are cleaned up on retry, file completion and shutdown.

Routes accept one of `json`, text `body`, or a project-local `fixture`. Optional `status`, `headers`, `contentType`, `method` and positive `times` control the response. URL patterns support `*` within a path segment and `**` across segments.

| Route `mode` | Behavior |
| --- | --- |
| `fulfill` (default) | Supply the configured response |
| `abort` | Block the matching request |
| `continue` | Send the real request; optional `request` changes URL, method, headers or body |
| `patch` | Fetch the real response and merge configured JSON fields or replace its text body |

Remove a route with `flow.network.unroute` and its `name`. Rules and captured events belong to the selected profile. `network.arm` also supports `kind: "request"`, a method, response status filter and timeout. `network.expect` checks status/method and captured body paths or a response/request `header`, using `equals` or `contains`.

## Downloads

```flow
flow.download.arm {
  "name": "invoice"
};
flow.click link "Download invoice";
flow.download.save {
  "name": "invoice",
  "file": "downloads/invoice.json"
};
flow.download.expect {
  "name": "invoice",
  "filename": "invoice.json",
  "minSize": 1,
  "json": {
    "paid": true
  }
};
```

The destination must stay inside the project and must not already exist. Assertions support the suggested `filename`, exact `size`, `minSize`, text `contains`, exact `json`, and a SHA-256 `sha256`. Content assertions have a size limit; use size/hash checks for larger downloads. Downloads do not need a custom plugin.

## Control time and observe functions

```flow
flow.clock.install {
  "time": "2026-01-01T00:00:00Z"
};
flow.open "/timer";
flow.clock.runFor {
  "milliseconds": 5000
};
```

Clock commands include `pauseAt`, `resume`, `runFor`, `fastForward`, `setFixedTime` and `setSystemTime`. Date operations accept `time`; advancing accepts `milliseconds`. Install the clock before the application installs its timers. Time control affects the browser page, not the backend or operating-system clock.

```flow
flow.stub.install {
  "name": "analytics",
  "target": "analytics.track",
  "mode": "spy"
};
flow.click button "Purchase";
flow.stub.expect {
  "name": "analytics",
  "count": 1,
  "args": ["purchase"]
};
flow.stub.restore {
  "name": "analytics"
};
```

A spy records calls and invokes the original function. Modes `return` and `throw` replace it with a configured `value` or `error`; `async: true` returns a promise. `beforeLoad: true` installs on the next document, for functions available before application initialization. It cannot replace a function that does not yet exist. `stub.expect` accepts `count`, `minCount`, arguments and timeout. Doubles belong to a page and are restored on cleanup.

## Traces, HAR and DOM evidence

```json
{
  "trace": true,
  "har": true,
  "domSnapshots": true,
  "browserOptions": {
    "serviceWorkers": "block"
  }
}
```

Trace ZIPs include browser actions, DOM snapshots and screenshots. HAR files capture HTTP requests and responses and finalize when their browser context closes. Evidence files include flow/profile names; retries retain earlier attempt videos/traces. A trace records browser operations; Flowstride assertion results and attempts are in `summary.json`.

Use `flow.trace.start` (optional `name`) and `flow.trace.stop` for an explicitly bounded trace instead of automatic `trace: true`. Open a local ZIP with:

```sh
npx flowstride trace flowstride-artifacts/example-trace.zip
```

HAR replay uses a local recorded file:

```flow
flow.har.replay {
  "file": "fixtures/customer.har",
  "notFound": "abort"
};
flow.open "/customer";
```

An optional `url` limits matching; `notFound: "fallback"` allows unmatched real requests. Replay does not restore application databases or a WebSocket session.

The dashboard preserves each step's profile and attempt, lets you choose earlier attempt screenshots, and links to optional DOM snapshots. DOM files are served as inert text. They do not rewind the live application or execute an earlier page.

Traces, HAR, downloaded files and DOM/accessibility snapshots can contain application secrets or personal data. They remain local artifacts; these new formats are not automatically uploaded to Cloud. Choose private CI artifacts and an appropriate retention period.

## Accessibility and ARIA baselines

```flow
flow.a11y.scan {
  "name": "checkout",
  "include": ["main"],
  "tags": ["wcag2a", "wcag2aa"]
};
flow.a11y.snapshot {
  "name": "checkout",
  "selector": "main",
  "baseline": "baselines/checkout.aria.yml"
};
```

Scans use axe, write a structured report, and fail on violations by default. Options include `exclude`, explicit `rules`, `disableRules`, selected `impacts`, and `maxViolations`. Automated scans cover only part of accessibility; keyboard and assistive-technology review remain necessary.

Snapshots compare the complete selected accessibility tree with a reviewed YAML baseline. `flow.a11y.match` compares an inline `yaml` string with the complete captured tree and retries until timeout. These are exact tree comparisons, not Playwright Test's partial snapshot matcher.

Create or deliberately update a baseline locally with `--update-baselines`; the snapshot command must specify `baseline`. CI refuses updates. Review baseline changes before accepting them. To capture evidence without comparing or writing a baseline, omit `baseline`.

## Component tests

Flowstride starts and cleans up a local Vite harness. Keep your normal application framework packages installed in the project. Supported integrations are vanilla JavaScript factories, React components and Vue single-file components. Other frameworks need a dedicated integration and qualification.

```flow
flow.component.mount {
  "framework": "react",
  "module": "src/components/AccountButton.tsx",
  "export": "default",
  "props": {
    "label": "Open account"
  }
};
flow.click button "Open account";
flow.assert.that {
  "selector": "button",
  "condition": "text",
  "value": "Account opened"
};
flow.component.update {
  "props": {
    "label": "Updated account"
  }
};
flow.component.unmount {};
```

An optional `css` array imports project styles. Supply required application providers through a small test component wrapper. The harness does not load your application Vite configuration, framework router, backend or production build automatically. Vanilla exports receive `(target, props)` and can return a DOM node or an object with `unmount()`.

## Scenario retries and flaky outcomes

```json
{
  "retries": 1,
  "failOnFlaky": true
}
```

Retries are disabled by default. A retry reruns the entire failed scenario, restores its starting browser profiles/storage and local variables, and retains previous attempt diagnostics. A later pass is marked `flaky`; `failOnFlaky` turns it into a failing CI outcome. Bail takes effect after the final failed attempt.

Retries cannot undo backend writes, emails, payments, persistent files, or other external effects. Use idempotent test data and explicit application fixtures. Keep retries low while investigating unstable tests.

## Browser matrices and multiple CI machines

```sh
npx flowstride ci init github --browsers chromium,firefox,webkit --shards 3
```

The generated workflow creates separate CI jobs with unique evidence names. It uses normal CI runners. Review project dependency/secrets setup as usual. Cancellation stops that job and records an interrupted result; it does not delete other machines' evidence.

```sh
npx flowstride run flows --ci --shard 1/3
npx flowstride run flows --ci --shard 2/3
npx flowstride run flows --ci --shard 3/3
```

Run each command on its assigned machine. Preserve its `summary.json` beside its `run-*` evidence folder. Collect all shards for **one browser configuration** into separate project directories and merge:

```sh
npx flowstride merge shard-1/summary.json shard-2/summary.json shard-3/summary.json
```

Merging rejects missing/duplicate shards, mixed source suites and mixed browser configurations. A failed or interrupted shard cannot become a passing merge. Setup `.first.flow` files execute independently on every machine, so setup must be safe to repeat. Metrics count actual shard executions, including repeated setup work.

For later runs, use `--shard-history path/to/timings.json` from a previous complete merge. Every machine must use the same file: history assigns longer files first while preserving deterministic, disjoint standard-file coverage. There is no hosted scheduling service or shared in-memory state between machines.

## Browser compatibility notes

Chromium's current stealth behavior can override an explicitly requested locale. Use Firefox or WebKit for locale-sensitive checks and verify the observed language. For HAR playback in Firefox/WebKit, leave forced browser-offline mode unset and stop the real server to verify the recording; combining forced offline mode and HAR can reject navigation before fulfillment.

The maintained command reference, browser compatibility guide and API-to-UI examples are available in the [Flowstride documentation](https://docs.flowstride.io/guide/native-browser-workflows).

## Assertion results and `And`

Native checks `flow.assert.that`, `flow.network.expect`, `flow.download.expect`,
`flow.stub.expect`, `flow.a11y.scan` and `flow.a11y.match` can appear under
`Then` or `And`. State-changing browser, route and clock commands belong under
`Given` or `When`.

```flow
Then "The login button is ready"
  flow.assert.that {
    "role": "button",
    "name": "Submit",
    "condition": "enabled",
    "timeout": 10000
  };
And "The heading is visible"
  flow.assert.that {
    "role": "heading",
    "name": "Welcome",
    "condition": "visible"
  };
```

Terminal, CI JSON/JUnit and dashboard evidence retain individual lookup and
condition results. A failing condition does not erase successful target checks.
Missing prerequisites and later steps are marked not evaluated / not tested.
Expected and observed values, timeout, profile and source location explain a
failure. These child diagnostics do not count as extra test steps.

All command failures retain the original adapter error, call log and nested
causes, plus command, file/line and relevant target/resource. This applies to
browser actions, APIs, plugins, sessions, games, audio and email workflows.
Timeouts are reported as observed timeouts, without inventing a root cause when
the application does not provide one. Secrets and terminal control characters
are protected in diagnostics.
