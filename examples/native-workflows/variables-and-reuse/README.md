# Variables, reuse and saved browser sessions

Flowstride can generate test data, extract values from APIs or pages, reuse them in later commands and persist a browser session. These mechanisms have different scopes and lifetimes.

| Requirement | Value |
| --- | --- |
| Engine | OS or Cloud |
| Browser | Chromium, Firefox or WebKit |
| Application | Shared local demo |
| Cloud account | Optional |

Complete the [shared setup](../README.md), including `EXAMPLE_LABEL="Workflow fixture"`, and keep the same demo-server process running for the session examples.

## Generate once, extract and reuse

[setup.first.flow](flows/setup.first.flow) sends generated data to the demo API, extracts it and reuses it in another API call and the browser:

```flow
Feature: Generated and extracted variable reuse
Scenario: Preserve one generated value across API and UI
Given "Generate data once and extract the response"
  flow.post "/api/echo" with reqBody;
  """
  {
    "email": "$randomEmail@example.test",
    "label": "{{env.EXAMPLE_LABEL}}"
  }
  """
  flow.extract resBody "email" as "rememberedEmail";
  flow.extract resBody "label" as global "sharedLabel";
When "The generated value is reused in a second API request"
  flow.post "/api/echo" with reqBody;
  """
  {
    "email": "@rememberedEmail"
  }
  """
And "Generation did not silently create another value"
  flow.expect resBody "email" equals "@randomEmail@example.test";
When "Reuse the extraction in a browser field"
  flow.open "/reuse";
  flow.type input "Selected value" "@rememberedEmail";
  flow.click button "Apply value";
Then "The browser received the exact value"
  flow.expect text "Selected @rememberedEmail";
```

`$randomEmail` generates a value; `@randomEmail` reuses the last generated value for that generator in this file. The suffix is literal: `$randomEmail@example.test` and `@randomEmail@example.test` keep the same complete address. A later `$randomEmail` call generates another value.

`flow.extract ... as "rememberedEmail"` stores a file-local extraction. `as global "sharedLabel"` makes the extraction explicitly process-global.

[reuse.flow](flows/reuse.flow) reads that global value from the next file:

```flow
Feature: Explicit process-global reuse
Scenario: Read a global extraction in the next file
Given "Open the reuse form"
  flow.open "/reuse";
When "Use the explicitly global label"
  flow.type input "Selected value" "@global[sharedLabel]";
  flow.click button "Apply value";
Then "The environment value survived the file boundary"
  flow.expect text "Selected Workflow fixture";
```

Run the two files together, sequentially:

```sh
npx flowstride run workflow-examples/variables-and-reuse/flows --workers 1 --ci
```

The `.first.flow` setup executes before the ordinary file. Expected: generated-email equality, exact UI reuse and `Selected Workflow fixture` in the second file. Both files pass.

## Scope and lifetime

| Mechanism | Use | Lifetime |
| --- | --- | --- |
| `{{env.NAME}}` | Application URLs, configuration values and private test credentials | Supplied by the process and loaded environment files |
| `$randomEmail` / `@randomEmail` | Generate a value / reuse its last remembered value | Generator memory resets for each file |
| `@rememberedEmail` | Reuse a local extraction | Current flow file, including later scenarios in that file |
| `@global[sharedLabel]` | Reuse an explicit global extraction | Current worker process; not shared memory across workers or machines |
| Browser `localStorage` / `sessionStorage` | Application browser storage | Browser profile/origin and application lifecycle |
| Persisted named session | Restore a saved browser snapshot in a later run | Local `.flowstride` session data until replaced/removed |

Keep the global example at one worker. A Cloud parallel run can use several processes; a global variable is not a shared cross-worker database. A later CLI invocation starts a new process and does not inherit these global variables. Undefined global references fail explicitly.

## Save and restore browser state

Run the [session-saving flow](sessions/save.flow):

```sh
npx flowstride run workflow-examples/variables-and-reuse/sessions/save.flow --ci
```

It creates a demo user, signs in through the UI and uses:

```flow
flow.save session "workflow-reader" persist;
```

Then run [restore.flow](sessions/restore.flow) in a fresh CLI invocation:

```sh
npx flowstride run workflow-examples/variables-and-reuse/sessions/restore.flow --ci
```

That file uses:

```flow
Feature: Restore a persisted account
Scenario: Restore in a fresh process
Given "Load the saved browser state"
 flow.use session "workflow-reader";
When "Open the account page"
 flow.open "/dashboard";
Then "Cookies and both storage types are restored"
 flow.expect visible "Welcome, Workflow Reader";
 flow.expect attribute "#storage" "data-mode" "signed-in";
 flow.expect attribute "#storage" "data-session" "active";
```

Expected: the signed-in account is visible and the stored local/session values are available before the dashboard's startup code reads them. Keep the demo server running: restarting it removes the backend user even if the browser snapshot still exists.

A snapshot captures cookies and Web Storage for the selected browser profile. Storage restoration is restricted to its matching top-level HTTP(S) origin and seeds the saved values once; later app changes and reloads are preserved. It does not inject saved storage into another site's frame.

Use a current snapshot with saved origin metadata. Legacy snapshots lacking an origin prefer the configured application base URL, then an available current application page. Configure the intended `BASE_URL` before restoring a legacy record. Persisted sessions contain credentials and belong outside version control.

Saving a session does not create a second live user. Use [named browser profiles](../../../NATIVE_BROWSER.md#separate-users-in-one-test) when customer and admin must stay independently signed in. Saved browser state is also separate from application backend data and arbitrary flow variables.

## Deliberate failures

```sh
npx flowstride run workflow-examples/variables-and-reuse/negative/wrong-reused-value.flow --ci
```

This reuses the extraction but expects a different UI value, so its assertion must fail and exit nonzero.

To observe process isolation, run `flows/reuse.flow` by itself in a new CLI invocation. It has no setup in that process, so `@global[sharedLabel]` must be undefined. This is a setup failure rather than a successful assertion; inspect the error and incomplete steps.

The [full variable reference](https://docs.flowstride.io/flow-language/getting-started/variables) covers aliases and additional examples. General `{{env.NAME}}` substitution belongs in command string values; do not assume every JSON configuration field performs the same substitution.
