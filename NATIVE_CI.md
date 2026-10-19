# Native CI and browser-game candidate

This candidate adds native CI and game APIs to both engines. Managed Cloud
execution remains retired. Existing npm OSS / private Pro archive distribution
and fallback remain supported. Consumer project migrations are managed separately. Native CI uses protocol 1.
The public CLI selects compatible Pro engines or logs the reason and falls back
to OSS. Older Pro CLIs may own the npm binary and do not understand the new
commands; install both candidates when testing the Pro path.

The candidates pin Playwright 1.59.1 in both engines; the native install command
installs that engine's matching Chromium.

## Local candidate check

Use a disposable project first. Install the OSS archive, then the Pro archive if
needed. Both candidates must be installed for testing the new Pro path. The
currently hosted Cloud download still serves the existing release; this local
candidate does not change that endpoint or its archive.

```sh
npm install --save-dev /absolute/path/flowstride-1.0.20-rc.6.tgz
# Optional: install the local matching Pro candidate after project dependencies.
npm install --no-save /absolute/path/flowstride-pro-1.0.15-rc.5.tgz
npx --no-install flowstride install
npx --no-install flowstride run --ci
```

Pro continues to require your normal valid developer credentials for licensed
features. Installing Pro uses `--no-save`: another `npm ci` can remove it. Keep
project dependency installation before Pro installation. An installed Pro package
can own `node_modules/.bin/flowstride`; both that entry point and the public OSS
entry point must be covered when checking fallback.

The sample in `examples/native-game` uses a tiny local canvas game. Copy its
files into a disposable project containing the installed candidates, then run
the command above. `server.mjs` is the game fixture's HTTP server; it contains no
Flowstride runner, adapter, worker, or CI orchestration code. A real application
uses its normal development/start command instead.

## Configuration

`flowstride.config.json` supports `testDir`, `baseUrl`, `timeout`, `device`
(`desktop`, `phone`, `landscape`), optional `viewport`, `pluginsDir`,
`artifactsDir`, `recordVideo` (boolean), `browserErrors` (`fail` or `record`), and
`webServer` (`command`, local readiness `url`, optional `cwd` and `timeout`).
Malformed configuration and unsafe output paths fail before execution.

Native CI is selected by `--ci` or a recognized CI environment. It runs without
a dashboard server, returns nonzero for failed/incomplete/crashed execution,
and writes latest `summary.json`/`junit.xml` reports at the configured artifact
root. Media and attachments go into a unique run directory referenced by the
summary, so local reruns retain history without mixing evidence.
SIGINT/SIGTERM produce interrupted results. The run owns its optional local
server and refuses an already-serving readiness URL.

Cloud reporting is off by default in native CI. `cloudSync: true` explicitly
allows existing authenticated reporting; matching Cloud deployment and configured media storage are required. Reporting and
video status are written separately in the summary and `.flowstride/cloud-sync.json`;
a reporting failure does not turn a passed test into a failed test. Normal interactive reporting and the restored
Cloud URL overrides remain separate from retired managed execution.

`npx flowstride ci init github` generates a workflow explicitly, never during
installation, and refuses to overwrite it. It assumes an npm project with a
committed lockfile. Other package managers and monorepos can use the composite
action's install-command and working-directory inputs. The composite action is
in the OSS repository's `action/` directory and becomes remotely usable only
once that source is pushed. Pin its commit when configuring a consumer workflow.
Pro jobs pass a developer token as a secret; dependency installation precedes
Pro login/install, matching-browser installation, execution, and artifact upload.

## Native game actions

Register the built-in alias with `let game = "flowstride:game"`. It requires no
custom plugin file. Available actions:

- `tap`: canvas selector, x/y; relative coordinates by default, or `unit: "pixels"`.
- `drag`/`swipe`: canvas, from/to coordinates, optional duration and input type.
- `key`: key name and optional hold duration.
- `checkpoint`: named screenshot, optionally of one canvas.
- `snapshot` and `expectVisual`: canvas comparison with explicit minChange/maxChange.
- `state`/`expectState`: exposed state, optional dotted path and expected equals.
- `snapshotState`/`expectPreserved`: compare selected state across actions/reloads.
- `fixture`: a named fixture registered by the application in explicit test mode.
- `select`: a stable object ID resolved by the game bridge, then real pointer input.

Visual checks establish pixel differences, not gameplay correctness; pair them
with state or UI assertions. Mobile profiles emulate Chromium devices, not
physical phones. Touch dragging currently uses Chromium CDP.

For a generic browser game, import `registerGame` from
`flowstride/dist/game/bridge.js` and supply readState and optional test-only
fixtures. The function manages the browser bridge; no global setup is required
in the test runner.

## Three.js integration

Import `registerThreeGame` from `flowstride/dist/game/three-bridge.js` in the game
bundle. Register the live scene, camera, canvas, the application's own Vector3
and Raycaster constructors, and an optional objects map keyed by stable IDs.
Alternatively, assign `userData.flowstrideId` to scene objects. Optional local
pick points use `userData.flowstridePickPoint: [x, y, z]`.

The bridge projects the live object and raycasts the live scene; hidden,
occluded, off-screen, covered or non-pickable objects fail explicitly. It creates
no renderer or animation loop. Dispose the bridge when the scene is replaced.

Optional `readState` provides observable state. `fixtures` are available only
when the application explicitly registers with `testMode: true`; use that
setting in dedicated test builds, never public production builds. Naija Throne
still defines campaign-specific fixtures/rules, using these supported APIs.

Custom plugins now receive `sdk.game`, `sdk.browser.page()`, and `sdk.run`
(device, artifact directory and attach method), alongside the existing SDK.
They need no global bridge or internal Flowstride class imports.

## Validation before release

Build both packages and run `npm run test:native`. For the optional live Three.js
fixture set `FLOWSTRIDE_THREE_BUILD` to a Three.js build directory containing
three.module.js and three.core.js. OSS CLI handoff tests use
`FLOWSTRIDE_PRO_SOURCE` pointing at the built Pro package.

Run the real archive install/handoff harness against both candidates, including
missing/broken Pro and revoked-token fallback. Validate GitHub's Linux execution,
real licensed download after local acceptance.
No push, npm publication, Cloud archive replacement or Naija Throne migration
is performed by building these candidates.

## Combined candidate behavior

Node.js 22.12 or newer is required. Flow discovery is recursive; `.first.flow`
files run before ordinary files. Reports identify nested flows by their relative
paths, and same-named videos receive distinct filenames. A failed scenario skips
its remaining steps and continues to later scenarios. `--bail` stops later work;
Pro executes bail runs sequentially. `only.Scenario:` selects that file's focus
scenario and report planning uses the same selection.

Configuration, plugin, environment, upload, vault and output paths must stay
inside the project, including resolved symlinks. Move shared fixtures into the
project rather than referring to external files. `FLOWSTRIDE_API_URL` takes
precedence over `NEXTJS_WEBHOOK_URL`; the legacy completion suffix is normalized.
Managed runner commands remain retired.

Logs redact credential fields, known generated secrets and signed capabilities.
Redaction cannot guarantee removal of arbitrary application data or visible
secrets in screenshots/videos. Review artifact access and test data accordingly.

The Pro installer rejects unsafe or incomplete archives, downloads above 32 MiB,
and checksum mismatches. Older Cloud servers without checksum headers remain
compatible and emit a warning; `FLOWSTRIDE_PRO_SHA256` can pin an expected digest.
On failed npm installation the previous Pro directory and CLI launchers are
restored. This is not a transaction over every project dependency npm may alter;
use a disposable project for candidate acceptance.

## Dashboard tab history

Completed test tabs restore that file's last captured step by default. Selecting
an earlier step remembers its history cursor separately for each file. A sidebar
step also selects the owning tab. Return to Live applies only to the selected
file, and a new suite/rerun clears old cursors and screens. Runner console and
network panels show the selected file's records; the full Logs view retains
suite-wide history. Flows/steps without screenshots show an explicit empty
state rather than another flow's screen.

Run `npm run test:dashboard:unit` for the Zustand store/history unit tests and
`npm run test:dashboard` for those tests plus the real Chromium dashboard
regression. The browser regression runs real local browser flows, then replays
their worker events over WebSocket into the built dashboard. It also supplies
explicit API-only/background-event fixtures. No live Cloud is required.

### Local cURL debugging

The interactive local dashboard keeps its cURL preview [REDACTED]. Copy raw cURL
uses the original request held separately in local memory, including its headers
and body. Other log fields stay redacted. Native CI and Cloud reporting continue redacting cURL and
credentials. Raw cURL is not restored for already-redacted historical runs.
The interactive runner binds to 127.0.0.1 and restricts HTTP Host/Origin and
WebSocket Origin to its own loopback address and port. Raw commands remain in
local debugger memory and IPC; they are not written to CI or Cloud reports.
