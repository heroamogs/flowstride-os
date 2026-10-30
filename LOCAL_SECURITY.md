# Local state and Cloud installation security

These controls apply to both OS and the Cloud engine. They preserve the existing JSON credentials, value vault and saved-browser-session formats.

## Credentials and saved state

Flowstride creates `.flowstride` and its private subdirectories with owner-only access. On Linux/macOS, directories use `0700` and files use `0600`, independently of the process umask. Existing owned files are tightened when read or replaced. On macOS, inherited or explicit allow ACLs are removed from private state. Windows uses a protected ACL granting the current owner full control; the implementation verifies the resulting ACL. Filesystems without the required ACL support fail closed instead of storing credentials with weaker access.

Private state rejects directory/file symlinks, dangling links, hard-linked files, special files and files owned by another user. Project and global credentials remain separate, and environment tokens retain their existing precedence. A workspace root can be an ordinary filesystem alias, but its `.flowstride` hierarchy must consist of real owned directories/files.

Writes use a private temporary file and atomic replacement. A failed replacement preserves the previous file and removes the temporary file. Credential JSON is limited to 64 KiB; saved state is limited to 64 MiB. Session names must be single filenames of at most 200 UTF-8 bytes; names cannot traverse directories. Windows filename restrictions also apply on Windows.

These are filesystem access controls, not encryption at rest or a sandbox for untrusted test/plugin code. Programs running as the same user, and privileged administrators, can still access that user's data. Keep project folders and machine accounts trusted.

## Reset containment

The existing Cloud `reset --values`, `reset --sessions` and `run --fresh` paths validate actual filesystem components before deletion. Both requested targets are checked before anything is removed. Unsafe links or deletion failures stop the operation and produce a failing exit code.

`--values` targets `.flowstride/vault.json`; `--sessions` targets `.flowstride/sessions`. Credentials and other project files are preserved. Reset removes files; it is not forensic erasure of disk snapshots or backups. OS does not gain a new reset subcommand from these changes.

## Cloud transport

Remote Cloud/control-plane connections require HTTPS. HTTP remains available for loopback development at `localhost`, IPv4 loopback and `::1`. The `FLOWSTRIDE_API_URL` and legacy `NEXTJS_WEBHOOK_URL` overrides remain supported, including their existing path normalization and precedence.

CLI authentication, installation, manual-media and automated-reporting clients do not follow redirects. Configure the final HTTPS service URL. Storage upload URLs must use HTTPS remotely as well. User application `BASE_URL` and ordinary API-test requests keep their existing HTTP support; these checks apply to Flowstride's Cloud clients.

## Installation integrity and fallback

Both installers verify the archive SHA-256 before invoking npm. The authenticated Cloud download already provides `X-Flowstride-Sha256`, so ordinary users do not need a new setting. A separately trusted `FLOWSTRIDE_PRO_SHA256` pin can also be used; when both are present, both must match. Missing, malformed or mismatched checksums stop installation without changing the existing engine.

The installer retains archive size/decompression limits, path/link restrictions, package identity checks, disabled lifecycle scripts and rollback of the previous engine/CLI launchers. Temporary archive directories use private permissions. Installation and update failures preserve the existing fallback path.

A checksum obtained from the same HTTPS Cloud service establishes consistency with that service's response. It does not replace independent publisher signatures or protect against a compromised publisher/service. Independent signed release metadata remains separate future work.

## Verification

Run `npm run test:private-security` after building the engine. The standard unit/security commands include the same checks. GitHub workflows also run the private-state suite on Windows with Node 22.12 and 24, in addition to the existing Linux/macOS regression jobs. The Windows tests inspect the real ACL when run on Windows; tests on other platforms validate the Windows command's fixed script, safe path handling and failure behavior.

Windows ACL behavior uses [Microsoft's Set-Acl API](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/set-acl?view=powershell-5.1). Unix mode bits alone do not establish an equivalent Windows DACL.
