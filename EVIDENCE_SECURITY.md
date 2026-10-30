# Evidence privacy in OS and Cloud

Test evidence is application data. A passing test is not proof that its screenshots, recordings or diagnostic archives are safe to share.

| Evidence | Behavior |
| --- | --- |
| Terminal, structured events, assertion errors | Credential keys and known secret values are redacted. Assertions retain expected/actual diagnostics and source locations. |
| Interactive cURL copy and Replay | Captured emails, passwords, tokens and cookies are masked in manual Replay templates and cURL copy. Replace required placeholders manually before sending; placeholders are rejected by both the dashboard and worker. Entered credentials are one-shot input and are re-masked after Send. emailVerified remains its actual value and type. Templates are excluded from portable reports and Cloud automation logs. Automated .flow requests continue using their configured credentials normally. |
| CI JSON/JUnit and legacy JSON | Local debugger-only captures are excluded from JSON exports. CI screenshots are separate private files. JUnit keeps redacted diagnostics. |
| Screenshots, videos and exported PDFs | Can contain visible private application data. Owner-only filesystem access is applied to automatic engine evidence. Pixels are not guaranteed to be sanitized. Manual PDF exports and user-chosen copies must be reviewed separately. |
| DOM and ARIA snapshots, accessibility reports | Can contain page text and application identifiers. DOM capture is opt-in and served as nonexecuting text through the local debugger. |
| HAR and Playwright traces | Are opt-in, raw diagnostic archives. They can include request/response content, cookies and page snapshots. Text redaction is not a sanitizer for these formats. Review before sharing. |
| Cloud video and manual attachments | Follow separate policies. Disabling automatic video upload does not block an attachment you explicitly upload from the manual editor. Cloud access remains workspace-authorized. |

## Reduce capture for sensitive environments

Both engines accept these settings in `flowstride.config.json`:

```json
{
  "recordVideo": false,
  "trace": false,
  "har": false,
  "domSnapshots": false,
  "security": {
    "evidence": {
      "screenshots": false,
      "cloudVideo": false
    }
  }
}
```

`security.evidence.screenshots: false` disables automatic step screenshots and live dashboard frames. It does not disable explicit game visual assertions/checkpoints or change their meaning. `cloudVideo: false` blocks automatic Cloud video upload while keeping eligible metrics reporting. Existing default capture behavior remains unchanged when these options are omitted. An explicit `flow.trace.start` still requests a raw trace even when automatic `trace` is false.

CI reporting to Flowstride Cloud remains opt-in through `cloudSync: true`. Screenshots, DOM, traces and HAR files are not silently added as Cloud log attachments. The Cloud service also strips local debugger-only fields and inline captures from automation-log submissions. This is not general data loss prevention for arbitrary application text or deliberately encoded data.

## Local access and export

Automatic evidence directories use owner-only access (`0700` on Unix); files are prepared with `0600`. Windows uses the same protected owner ACL mechanism as private state. Existing evidence is tightened before reuse/export. Links, hardlinked files and special files are rejected at guarded output boundaries; a configured artifact directory cannot be a credential, Git or dependency directory. These controls are not encryption and cannot isolate programs running as the same user or administrators.

`flowstride init` excludes `.flowstride`, the default artifact directory and generated legacy reports from Git. Add any custom artifact/export directories to your own `.gitignore`. CI artifact retention is controlled by the workflow; the generated GitHub workflow requests 14 days. Platform/account access and retention settings still need review.

Flowstride does not silently delete your local evidence according to a new age policy. Remove a disposable test project's generated output when finished; preserve fixtures and baselines you intentionally maintain. Cloud retention requires a configured, monitored scheduler and successful object deletion, as documented in the hosted Cloud operational guide.

Use synthetic accounts and fixtures for sharable examples. Review images visually and examine HAR/trace content locally before distributing it. [Playwright documents what its trace viewer exposes](https://playwright.dev/docs/trace-viewer).
