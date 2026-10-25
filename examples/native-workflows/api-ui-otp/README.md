# API + UI + email OTP

FlowMail retrieves an OTP delivered to a supported test inbox and stores it in a flow variable. The same test can register through your application's API, sign in through its UI, enter the code and assert successful authentication.

| Requirement | Value |
| --- | --- |
| Engine | Cloud; `flow.mail.getOtp` is a Cloud service command |
| Browser | Chromium, Firefox or WebKit for ordinary browser interactions |
| Cloud access | Authenticated developer token and available workspace FlowMail allowance |
| Application | An authorized test application that actually sends email OTP |
| Inbox | An address supported by FlowMail, using `@flowstridemail.com` |

Cloud includes free accounts. FlowMail allowances depend on the workspace plan and current usage. This chapter's templates require your application's real routes and selectors; the shared local demo does not send email.

## Connect Cloud

Follow the normal [npm setup](../README.md), then:

```sh
npx flowstride login
```

Use your developer token at the prompt and accept authenticated engine installation when offered. In CI, use the `FLOWSTRIDE_TOKEN` secret and the normal Cloud setup described in [NATIVE_CI.md](../../../NATIVE_CI.md).

## Register, sign in and verify

[api-ui-otp.flow](templates/api-ui-otp.flow) is a complete application template. Its contract is:

- Registration accepts the shown fields, returns `201` and a `userId`, and leaves the account active for sign-in.
- The login form has Email, Password and Login targets.
- Login triggers an email to the generated address.
- The challenge has an Enter 6-digit OTP input and Verify OTP button.
- `Logout` is visible only after authentication completes.

Adapt these fields, selectors and expected results to your application. In your private `.env`, configure:

```dotenv
SIGNUP_URL=https://your-test-application.example/api/register
LOGIN_URL=https://your-test-application.example/login
```

The template contains the full API-to-UI journey:

```flow
Feature: Register through an application API and verify an email OTP in the UI

  Scenario: Complete an email-verified sign-in with a disposable account
    Given "The application creates an active test account"
      flow.post "{{env.SIGNUP_URL}}" with reqBody;
      """
      {
        "firstName": "Example",
        "lastName": "Reader",
        "email": "$randomEmail@flowstridemail.com",
        "password": "$randomPassword"
      }
      """
      flow.extract resBody "userId" as "newUserId";
      flow.expect status "201";

    When "Open the application's sign-in form"
      flow.open "{{env.LOGIN_URL}}";
      flow.type input "Email" "@randomEmail@flowstridemail.com";
      flow.type input "Password" "@randomPassword";
      flow.click button "Login";

    When "Retrieve the delivered code through FlowMail"
      flow.mail.getOtp "@randomEmail@flowstridemail.com" into "loginOtp";

    When "Submit the retrieved code"
      flow.type input "Enter 6-digit OTP" "@loginOtp";
      flow.click button "Verify OTP";

    Then "The application confirms successful authentication"
      flow.expect visible "Logout";
```

`$randomEmail` and `$randomPassword` generate values; `@randomEmail` and `@randomPassword` reuse their remembered values in this file. The address suffix must stay consistent between registration, UI sign-in and inbox polling.

Run the adapted template explicitly:

```sh
npx flowstride run workflow-examples/api-ui-otp/templates/api-ui-otp.flow --ci
```

Expected: registration succeeds, the code is retrieved and entered, the application confirms sign-in, and the process exits `0`.

### Applications requiring approval

If registration creates a pending account, add your application's authorized approval step before browser sign-in. For an application whose approval API uses a bearer token, an example block is:

```flow
When "Approve the test account using application authorization"
  flow.post "{{env.APPROVAL_URL}}"
    with reqHeader "Authorization" "Bearer {{env.APPROVAL_TOKEN}}"
    with reqBody;
  """
  {
    "userId": "@newUserId"
  }
  """

And "The application accepted approval"
  flow.expect status "200";
```

Use your application's actual authorization scheme and verify the resulting active state. A cookie-based approver session needs its own application setup. A `401` or `403` at this step prevents the test from reaching OTP and must be resolved as an application prerequisite.

## Use an existing account

For a preapproved account, adapt [existing-account-otp.flow](templates/existing-account-otp.flow) instead. Configure:

```dotenv
LOGIN_URL=https://your-test-application.example/login
OTP_TEST_EMAIL=your-supported-test-address@flowstridemail.com
OTP_TEST_PASSWORD=replace-with-the-application-test-password
```

```sh
npx flowstride run workflow-examples/api-ui-otp/templates/existing-account-otp.flow --ci
```

The chosen account must require an email OTP challenge. An account that signs in directly does not exercise email delivery or retrieval.

## Negative checks and diagnosis

For a deterministic assertion failure, change the final expected login marker to a value your application never displays. The run must fail even after code retrieval succeeds. To test invalid-code handling, use a code known to be invalid for that request and assert the application's rejection message; a fixed six-digit value is not guaranteed to be wrong.

FlowMail polls up to ten times with delays. Authentication or permission rejection stops the lookup; an inbox with no matching code eventually times out. Set a suitable test timeout for delivery and your application's processing time.

| Result | Check |
| --- | --- |
| No Cloud authentication | Run `npx flowstride login` or configure the CI secret |
| Permission/allowance rejection | Check workspace access, token validity and FlowMail usage |
| Approval returns `401`/`403` | Supply authorized application setup before sign-in |
| No email arrives | Confirm the application actually sends to the same supported address |
| Login succeeds without challenge | Use an account that requires OTP |
| Code retrieved, login still fails | Inspect application expiry, validation and the final UI outcome |

Code retrieval alone is not a passed authentication test. Keep the final application assertion, and isolate account creation/mail side effects when designing retries.
