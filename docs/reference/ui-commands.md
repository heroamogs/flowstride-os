# UI Automation & Dynamic Data Reference

The Flowstride UI Engine is powered by Playwright, providing high speed, non blocking browser manipulation. This reference manual covers all available action tokens, element qualifiers, spatial layouts, and dynamic data generators.

---

## 1. Action Tokens

Action tokens define the core interactions your user performs on the page.

- `flow.open "URL"`: Navigates the browser to the specified web address.
- `flow.click [element] "selector"`: Clicks an element. Uses the Smart Selector Engine to resolve text, accessibility labels, or CSS.
- `flow.forceClick [element] "selector"`: Bypasses standard visibility and actionability checks to force a click. Includes a built in sniper hack to auto solve Cloudflare Turnstile challenges if targeted.
- `flow.type [element] "selector" "text"`: Clears the target input and types the specified text sequentially.
- `flow.forceType [element] "selector" "text"`: Forces text into an input field directly, bypassing UI event restrictions.
- `flow.passcode [element] "selector" "value"`: Intelligently distributes a multi character string across segmented OTP or passcode input boxes.
- `flow.set [element] "selector" to "value"`: Sets the value of an input field directly via the DOM. Includes an automated fallback scanner for complex React or Angular date pickers.
- `flow.select "option" from [element] "selector"`: Selects an item from a drop down menu. Capable of handling native `<select>` tags as well as complex portal rendered div drop downs.
- `flow.drag [element] "source" into [element] "destination"`: Performs a full mouse click, hold, and drag to drop an element onto a target.
- `flow.check [element] "selector"`: Activates a checkbox or radio button. Will fallback to a standard click if the UI uses custom div overlays for checkboxes.
- `flow.uncheck [element] "selector"`: Deactivates a checkbox.
- `flow.upload "filepath" into [element] "selector"`: Bypasses the native operating system file explorer to directly upload a document into the DOM.
- `flow.close "Modal Text"`: Uses the Spatial Geometric Engine to automatically find the correct cross or close button situated in the top right corner of a modal containing the specified text.

---

## 2. Element Qualifiers

You can explicitly guide the Smart Selector Engine by prepending an element qualifier to your target string. This resolves ambiguity when multiple matching texts exist on screen.

- `button`
- `link` or `a`
- `input` or `field`
- `div`
- `span`
- `image` or `img`

**Example:**

```bash
flow.click button "Submit";
flow.type input "Email Address" "test@test.com";
```

---

## 3. Spatial Modifier Layout

When text matching is insufficient, you can use relational spatial math to locate an element based on its visual proximity to an anchor element.

- `near`
- `above`
- `under` or `below`
- `leftOf`
- `rightOf`
- `inside` or `in`

**Example:**

```bash
flow.click button "Save" near "User Profile";
flow.type input "Amount" below "Total Balance" "500";
```

---

## 4. Resilience: The Try Modifier

To create non blocking optional steps, prefix your action command with the `flow.try` modifier. If the target element fails to appear or the action times out, the framework will gracefully log a warning and skip the step instead of failing the test case.

**Example:**

```bash
flow.try click "Dismiss Promotional Banner";
```

---

## 5. Window Control & Media

Flowstride includes native control over browser tabs, system dialogs, and media streams.

- `flow.switchTo "target"`: Shifts browser focus. You can use `"next"`, `"previous"`, or specify a partial window title or URL.
- `flow.acceptDialog`: Instructs the engine to automatically click "OK" on the next native browser alert or confirmation pop up.
- `flow.rejectDialog`: Instructs the engine to automatically click "Cancel" on the next native browser alert.
- `flow.injectAudio "fixtures/filename.wav"`: Feeds a mock .wav audio file (must be located within your /fixtures directory) directly into the browser microphone stream, bypassing physical hardware checks.
- `flow.waitForPipeline`: Synchronises test execution by pausing the runner for the exact calculated duration of the injected audio file.

---

## 6. Dynamic Data Generation Engine ($)

Flowstride ships with a deterministic data generation engine to ensure tests use clean, unique data. Prepend the `$` symbol to generate a fresh value.

- `$uuid`: A random V4 UUID.
- `$timestamp`: Current Unix timestamp.
- `$randomFirstName`
- `$randomLastName`
- `$randomFullName`
- `$randomEmail`: Base domain email.
- `$randomPhone`
- `$randomPassword`: Highly secure alphanumeric password.
- `$randomOtp`: Six digit numeric sequence.
- `$randomCompany`
- `$randomAmount`
- `$today`
- `$tomorrow`
- `$yesterday`

---

## 7. State Retrieval Engine (@)

Whenever the engine generates a `$variable`, it permanently locks that value into the runtime memory bank for the duration of the scenario. You can pull that exact same value down later, within the same Scenario block, by substituting the `$` with `@`.

**Example:**

```bash
Given "Generate and type a fresh email";
  flow.type "Email" "$randomEmail";

When "Type the exact same email generated in the step above";
  flow.type "Confirm Email" "@randomEmail";
```

---

## 8. Email Domain Overrides

You can forcefully route generated emails to specific custom domains to test external inbox routing.

- **Generation**: `$randomEmail@gmail.com`
- **Retrieval**: `@randomEmail@gmail.com`

---

## 9. The Spatial Correlation Engine

When generating address data, mixing random fields often leads to logically invalid combinations (e.g., a city in Texas mapped to the country of Japan). The Correlation Engine generates guaranteed valid triplets.

- `$randomPair[Country]`
- `$randomPair[State]`
- `$randomPair[City]`

Retrieve the locked correlated values using `@randomPair[City]`.

---

## 10. The Bug Hunter Payload Generators

Designed for security and boundary testing, these generators inject chaotic string payloads to test your application boundaries.

- `$maliciousString`: Injects SQL/XSS attempt payloads.
- `$invalidEmail`: Malformed email structures.
- `$overflowString`: Massively long character strings.
- `$specialChars`: Unicode and special character boundary testing.
