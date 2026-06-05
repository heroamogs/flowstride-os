# API, Observability & Assertions Reference

Flowstride unifies UI and API testing by integrating the high-speed Undici HTTP client directly into the parsing engine. This allows you to perform backend data seeding, intercept responses, and validate system states seamlessly within the exact same scenario as your visual UI steps—all without context switching.

---

## 1. The Power of Multi-Line Docstrings (`"""`)

Before diving into API commands, it is vital to understand how Flowstride handles data payloads. When sending JSON bodies or GraphQL queries, writing standard strings requires you to manually escape every single quote (e.g., `"{\"username\": \"test\"}"`), which makes tests unreadable.

To solve this, Flowstride natively supports **multi-line docstrings** using triple quotes (`"""`). This allows you to paste raw, unescaped JSON or GraphQL directly into your `.flow` scripts.

**Example:**

```bash
When "Submit a complex payload"
  flow.post "/api/data" with reqBody """
  {
    "user": "standard_user",
    "settings": {
      "theme": "dark"
    }
  }
  """
```

---

## 2. Explicit HTTP Methods

Flowstride natively supports all standard RESTful operations. You can attach JSON payloads directly to the request using the `with reqBody` preposition, and attach headers using `with reqHeader`. The engine acts intelligently: if it detects a JSON body, it automatically injects the `Content-Type: application/json` header for you.

- `flow.get "endpoint"`
- `flow.post "endpoint"`
- `flow.put "endpoint"`
- `flow.patch "endpoint"`
- `flow.delete "endpoint"`

**Example:**

```bash
Given "User authenticates via API to skip the slow UI login"
  flow.post "/api/v1/users" with reqBody """
  {
    "email": "user@flowstridemail.com",
    "password": "Test@12345"
  }
  """
```

---

## 3. GraphQL Engine

The engine includes a dedicated `flow.graphql` processor. You do not need to manually format your query into a JSON object (e.g., `{"query": "..."}`). The Flowstride parser detects raw GraphQL syntax and automatically wraps it in the standard GraphQL JSON payload structure under the hood.

**Example:**

```bash
When "Fetch the user profile via GraphQL"
  flow.graphql "/graphql" with reqBody """
  {
    user(id: 1) {
      name
      email
    }
  }
  """
```

---

## 4. State Transformations (Data Interception)

You do not need to write complex JavaScript variable assignments to capture API data. The `flow.extract` command intercepts the most recent network response in memory and saves a specific JSON path, header, or cookie to your local or global variables.

Once extracted, you can inject these variables into any future step (both API and UI) by prefixing the variable name with the `@` symbol (e.g., `@authToken`).

- **Valid Targets**: `resBody`, `reqBody`, `resHeader`, `reqHeader`, `cookie`
- **Scope Definition**: Save locally (`as "varName"`) or globally across scenarios (`as global "varName"`)

**Example (Extracting and Using user id):**

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

---

**Why This Changes Everything:**

Notice the absolute fluidity of this scenario. In traditional frameworks, achieving this workflow requires combining multiple tools (like Postman and Cypress, or Playwright), writing complex database seeding scripts, and managing fragile global state managers.

Flowstride eliminates all of that friction. In a single, unbroken block of code, you can:

1. **Bypass Slow UI Setup:** Seed the database instantly via the backend API.
2. **Generate & Track Dynamic Data:** The engine natively generates a secure password (`$randomPassword`), extracts the backend database ID (`@newUserId`), and locks both into the test's memory bank.
3. **Cross the API/UI Boundary:** Without dropping context or writing custom bridging code, the engine immediately drives the Playwright browser and injects the exact same memory state (`@randomPassword`) straight into the visual DOM.

This is the holy grail of end-to-end testing: **blindingly fast API state manipulation combined with high-fidelity visual validation**, sharing a single memory vault, with zero context switching.

---

## 5. FlowMail Engine Integration

Flowstride eliminates the need for expensive third-party email testing services or complex API polling logic by integrating a native OTP (One-Time Password) interception engine.

Using the `flow.mail.getotp` command, the engine will securely poll your private test inbox, parse the email contents, and automatically extract the numeric verification code into a runtime variable.

**Example (Extracting and Using an OTP in the UI):**

```bash
When "Extract the one time passcode sent to the user"
  flow.mail.getotp "user@flowstridemail.com" into "otpCode"

Then "Type the extracted passcode into the UI"
  flow.type input "Passcode" "@otpCode"
```

---

## 6. Assertions Layer (`flow.expect`)

The `flow.expect` command is your primary tool for validating system states. Because Flowstride is a unified framework, `flow.expect` operates seamlessly across both backend API responses and visual UI elements.

### API Observability Modifiers

- `status`: Validates the exact HTTP status code (e.g., `flow.expect status "200"`).
- `responsetime`: Asserts performance thresholds (e.g., `flow.expect responsetime lessthan "500"`).
- `resBody`: Evaluates JSON paths against specific conditions.
- `resHeader`: Evaluates response headers.
- `cookie`: Evaluates set cookies.

### UI Observability Modifiers

- `visible`: Asserts that an element is physically rendered and visible on screen.
- `text`: Asserts exact text content within an element (supports the `contains` modifier for fuzzy matching).
- `value`: Validates the actual input value of a form field.
- `attribute`: Extracts and validates specific HTML DOM attributes (e.g., `flow.expect attribute "Submit" "disabled" "true"`).
- `transcript`: Integrates with multimodal audio injections to assert that a specific phrase was transcribed or rendered dynamically (e.g., `flow.expect transcript contains "hello world"`).

---

## 7. Prepositional Condition Registry

When evaluating data (especially API responses via `resBody`), Flowstride provides a strict, human-readable registry of prepositional conditions. You can chain these conditions to perform highly complex data validations without writing raw assertion logic.

### Equality and Type Checks

- `equals`
- `contains`
- `to.be` / `to.not.be`
- `is` / `is.not`
- `type.of` (Supports: string, number, boolean, array, object, null, undefined)
- `format` (Supports: email, uuid, url, date, hex)
- `matches` (Regex validation)

### Mathematical & Length Comparisons

- `lessthan`
- `greaterthan`
- `length`
- `length.greaterthan`
- `length.lessthan`

### Structural Integrity

- `includes` / `does.not.include` (For arrays and strings)
- `has.key` / `does.not.have.key` (For JSON objects)
- `is.empty` / `not.empty`

**Example of Chained Assertions:**

```bash
Then "Verify the API response payload is structurally sound"
  flow.expect resBody "data.user" type.of "object" has.key "id"
  flow.expect resBody "data.user.email" format "email"
  flow.expect resBody "data.user.age" greaterthan "18"
```
