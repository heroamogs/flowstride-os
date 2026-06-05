## Your First .flow Script

When you ran the init command, Flowstride automatically generated a flows/ directory in your project root. This is where all your test suites should live.

Create a new file named qacarLogin.flow inside that flows/ directory and add the following code:

```bash
Feature: User Authentication;

Scenario: Verify Valid Account Access;

Given "Browser is opened to the secure login dashboard";
  flow.open "https://www.qacar.online/login";

When "User inputs active credentials";
  flow.type "Email" "user@flowstridemail.com";
  flow.type "Password" "Test@12345";

Then "User clicks on Login button";
  flow.click button "Login";
```

## Running Your Tests

Once your script file is saved, trigger the sequential execution runner by pointing it to your file path. Flowstride initializes a local orchestration server on port 4321 to sync visual telemetry frames directly to your active browser interface.

### If you are using npm:

```Bash
npx flowstride run flows/qacarLogin.flow
```

## If you are using yarn:

```Bash
yarn flowstride run flows/qacarLogin.flow
```

### Note

The orchestrator will automatically spin up an interactive reporting dashboard at http://localhost:5173. When execution completes, you can review high-fidelity logs, structural state snapshots, captured browser screenshots, and an inline cURL synthesizer window recording network behaviors in real time.
