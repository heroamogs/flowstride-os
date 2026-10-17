# Native CI and browser-game candidate

This candidate adds native CI and game APIs to both engines. Managed Cloud
execution remains retired. Existing npm OSS / private Pro archive distribution
and fallback remain supported. Naija Throne's current runner is unchanged;
its migration is a separate acceptance step. Native CI uses protocol 1.
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
npm install --save-dev /absolute/path/flowstride-1.0.20-rc.1.tgz
# Optional: install the local matching Pro candidate after project dependencies.
npm install --no-save /absolute/path/flowstride-pro-1.0.15-rc.1.tgz
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
allows existing authenticated reporting; its existing server-side security and
storage limitations still apply. Normal interactive reporting and the restored
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
real licensed download and Naija Throne migration after local acceptance.
No push, npm publication, Cloud archive replacement or Naija Throne migration
is performed by building these candidates.

## Candidate acceptance automation

The repository's `Native CI acceptance` workflow tests Node 22 and 24 on Linux.
It uses a checksum-pinned archive in `.github/fixtures`, checks its compiled engine
against a fresh build, checks referenced dashboard assets, then installs that exact
archive in a clean consumer. It exercises native browser installation, passing and
deliberately failing game execution, media, server cleanup and workflow preservation.
It also runs the native source suite, including delayed uploads and cancellation.
The Pro archive belongs only in the private Pro repository.

These jobs do not publish npm packages, replace the hosted Pro archive, deploy
Cloud, or migrate application repositories. Native Cloud reporting stays opt-in.
Qualification covers Chromium and emulated desktop/phone/landscape profiles.
Physical Android/iOS devices, Safari/Firefox and other game engines are outside
this candidate's verified support scope. Real Cloud licensing, reporting and
video storage require a separate live acceptance run.
