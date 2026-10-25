# API + UI in the same test

One `.flow` scenario can create data through an API, extract the response, interact with the browser and make another API request to verify the outcome. No custom runner is needed.

| Requirement | Value |
| --- | --- |
| Engine | OS or Cloud |
| Browser | Chromium, Firefox or WebKit |
| Application | Shared local demo, running in another terminal |
| Cloud account | Optional for this example |

Complete the [shared setup](../README.md), including `.env` and the running application.

## Complete example

[Read the runnable file](flows/api-and-ui.flow). It creates a disposable demo user, reuses its returned email in the UI and checks the recorded login count:

```flow
Feature: API and browser in one test
Scenario: Create through API and sign in through UI
Given "Create a disposable user"
  flow.post "/api/users" with reqBody;
  """
  {
    "email": "$randomEmail@example.test",
    "password": "fixture-password",
    "name": "Workflow Reader"
  }
  """
  flow.extract resBody "id" as "createdId";
  flow.extract resBody "email" as "createdEmail";
And "Creation succeeds"
  flow.expect status "201";
When "Sign in through the browser"
  flow.open "/login";
  flow.type input "Email" "@createdEmail";
  flow.type input "Password" "fixture-password";
  flow.click button "Sign in";
And "The UI shows the created account"
  flow.expect visible "Welcome, Workflow Reader";
When "Verify backend state from the same test"
  flow.get "/api/users/@createdId";
Then "The backend recorded the browser login"
  flow.expect status "200";
  flow.expect resBody "loginCount" equals "1";
```

`@createdId` and `@createdEmail` are extracted values available later in this file. The browser's UI login changes the backend; the final API assertion verifies that change.

Use `And` for an intermediate assertion block. `Then` closes the scenario, so put the final outcome there rather than adding more steps after it.

## Run and inspect

From the project root:

```sh
npx flowstride run workflow-examples/api-and-ui/flows/api-and-ui.flow --ci
```

Expected: HTTP registration status `201`, visible `Welcome, Workflow Reader`, backend `loginCount` equal to `1`, and a passed summary with process exit code `0`.

Try another browser with `--browser firefox` or `--browser webkit`. The same test commands work after connecting Cloud.

## Deliberate failure

```sh
npx flowstride run workflow-examples/api-and-ui/negative/wrong-backend-state.flow --ci
```

That file expects `loginCount` to equal `99`. The browser login still occurs, but the final assertion must fail and the process must exit nonzero. Inspect the failed step, screenshot and video. A completed HTTP request is not proof of HTTP success: use an explicit status/body assertion.

## Adapt to your application

Replace the API routes, request fields, response extraction paths and UI labels with your application's contract. Keep expected status codes and business outcomes explicit. Use disposable test accounts and provide an application-appropriate cleanup path when the backend stores data persistently.

The demo intentionally uses minimal local test authentication. Your application may require CSRF handling, application credentials or a privileged setup account. A Flowstride Cloud developer token authorizes Cloud services; application API authorization is configured separately.

Variables are shared through Flowstride's variable mechanisms; browser cookies and direct API authentication are separate state. Use the [saved-session guide](../variables-and-reuse/README.md#save-and-restore-browser-state) when you need a browser snapshot, and configure API request headers explicitly for your application's protected endpoints.

For an email challenge after login, continue with [API + UI + OTP](../api-ui-otp/README.md).
