# Engine release checks

Pushes and pull requests build the engine and Rust/WASM dashboard from locked dependencies. GitHub Actions covers Ubuntu and macOS with Node.js 22.12.0 and Node.js 24. Matching Chromium, Firefox and WebKit binaries are installed before unit tests, security regressions and the full native/dashboard regression suite.

High and critical findings in shipped engine/dashboard dependencies fail the checks. Full development audits are retained separately. Package inventory and clean archive execution checks verify the distributable. Each OS/Node job retains its archive and audit evidence.

OS CI uses public source only. The private Cloud repository can additionally check the matching public OS source for installation, authorization, browser selection and engine fallback. Private engine source and archives stay in the private repository and download channel. Checks requiring both repositories can also be run locally with explicit source paths.

Browser tests qualify their covered paths; Three.js fixtures are qualified on Chromium. The documented Chromium locale and Firefox/WebKit forced-offline HAR limitations remain separate known cases. Passing tests do not establish every framework, device or operating-system combination.

Publishing is a separate operation. These workflows do not publish npm packages, upload the private download archive or change the Cloud service's selected download.
