# Work with iFrames

Flowstride can discover a readable control in a child frame and can scope native assertions to an explicit iframe. For an action requiring an exact child-frame CSS selector, use the focused plugin example in this chapter.

| Requirement | Value |
| --- | --- |
| Engine | OS or Cloud |
| Browser | Chromium, Firefox or WebKit |
| Application | Shared local demo |
| Cloud account | Optional |

Complete the [shared setup](../README.md) and leave the demo app running.

## Readable target with an explicit frame assertion

The `/frames` page embeds a profile containing a **Frame action** button. The button is inside the iframe; the parent page has no matching control.

[readable-frame.flow](flows/readable-frame.flow):

```flow
Feature: Supported iframe interaction
Scenario: Find a readable target in a child frame
Given "The embedded profile is open"
  flow.open "/frames";
When "Click the readable child-frame target"
  flow.click "Frame action";
Then "Assert the explicit child-frame result"
  flow.assert.that {
    "frame": "#profile-frame",
    "selector": "#frame-result",
    "condition": "text",
    "value": "Clicked in frame"
  };
```

Run:

```sh
npx flowstride run workflow-examples/iframes/flows/readable-frame.flow --ci
```

Expected: the child-frame button is clicked, its result changes to `Clicked in frame`, and the frame-scoped assertion passes.

`flow.click "Frame action"` uses readable-target discovery. The assertion's `frame` identifies the iframe in the parent document, and its `selector` identifies the result inside that frame.

## Exact frame action through a project plugin

A raw selector such as `flow.click "#frame-only"` is not a general instruction to search every frame. The raw-selector path and readable-target discovery have different behavior.

[frame-actions.ts](plugins/frame-actions.ts) uses the public plugin browser access:

This optional TypeScript plugin needs a compatible compiler in your project. Install it before running the plugin example:

```sh
npm i --save-dev typescript@5.9.3
```

The native readable-target example above does not need this extra setup. Keep the compiler in your lockfile so CI uses the same version; newer compiler majors may be incompatible with the plugin loader.

```ts
export async function click(sdk: any, args: { frame: string; selector: string }) {
  await sdk.browser.page()
    .frameLocator(args.frame)
    .locator(args.selector)
    .click();
}
```

The supplied file also validates its arguments. [explicit-frame-plugin.flow](flows/explicit-frame-plugin.flow) registers the plugin and calls it:

```flow
Feature: An explicit iframe action through a focused project plugin
  let frameActions = "workflow-examples/iframes/plugins/frame-actions.ts";

  Scenario: Click a CSS target in the selected child frame
    Given "The embedded profile is open"
      flow.open "/frames";

    When "Click the explicit child-frame selector"
      frameActions.click {
        "frame": "#profile-frame",
        "selector": "#frame-only"
      };

    Then "The selected frame shows its result"
      flow.assert.that {
        "frame": "#profile-frame",
        "selector": "#frame-result",
        "condition": "text",
        "value": "Clicked in frame"
      };
```

```sh
npx flowstride run workflow-examples/iframes/flows/explicit-frame-plugin.flow --ci
```

Expected: the same child-frame result passes. This is a project extension for the explicit action; it uses the normal Flowstride runner and requires no private runner imports.

## Deliberate failure

```sh
npx flowstride run workflow-examples/iframes/negative/wrong-frame-result.flow --ci
```

The button is clicked, but the assertion expects `Never clicked`. The mismatch must fail, retain failure evidence and exit nonzero.

## Scope and troubleshooting

- Use a unique readable target or select the frame explicitly when several frames contain the same control.
- The `frame` option belongs to the native assertion shown here; it is not an extra argument supported by every legacy action.
- This fixture has one same-origin iframe. Qualify your own nested, cross-origin, sandboxed or dynamically replaced frame structure. A focused plugin can explicitly chain `frameLocator` calls for nested frames.
- Confirm that the iframe and its document actually load. An assertion retries its condition; it does not repair a failed application navigation.
- iFrames and browser tabs are different. `flow.switchTo "next"` switches pages/tabs in the current profile, not an iframe.

See the [plugin guide](https://docs.flowstride.io/flow-language/getting-started/plugins) and [native assertions](../../../NATIVE_BROWSER.md#assertions-that-wait-for-a-condition).
