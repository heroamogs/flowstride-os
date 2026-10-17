# Flowstride 1.0.20-rc.2 — npm preview

Publish channel: `next`. This preview does not move `latest` and does not publish
or replace the private Pro engine. The matching Pro candidate is `1.0.15-rc.1`.

## Changes since rc.1

- Require Node.js 22.12.0+ and align package, lockfile, CLI version and guides.
- Add an explicit preview publication configuration targeting the public npm
  registry and `next`, plus matching CLI-version/engine metadata checks.
- Clarify preview installation, native CI/game scope and Cloud/Pro limitations.
- Replace absolute privacy guarantees in the README with the actual data flow.
- Rebuild the engine from the merged OSS source; reuse the unchanged dashboard
  from the checksum-verified rc.1 archive. No runner or game behaviour changes.

## Native features inherited from rc.1

`flowstride run --ci`, `flowstride install [--with-deps]`,
`flowstride ci init github`, supported plugin/game SDKs, canvas/Three.js bridges,
Chromium desktop/phone/landscape profiles, JSON/JUnit reports and failure media,
safe file-chooser handling and interrupted-run cleanup.

## Known limits

Cloud login still downloads Pro 1.0.14, which does not support these native
commands. Test OSS alone, or authenticate first and then manually install the
matching local Pro candidate. Project dependency installation can remove a
no-save Pro package; install Pro afterward. Public-CLI native fallback remains
available for absent, broken or incompatible Pro engines.

Live Cloud reporting and video-storage issues are unresolved. Native CI keeps
reporting off by default; this preview does not enable the retired managed
runner. Application-specific game rules/fixtures remain application code.
Physical phones, Safari/Firefox and other game engines are not qualified.

## Publication

Only the verified OSS archive should be published. Use the `next` tag explicitly;
then verify `flowstride@next` and reinstall from npm in a disposable consumer.
No npm publication is performed while preparing this candidate.
