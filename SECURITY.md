<!-- kit: community v0.1.0 · the fleet default SECURITY policy (UPS-REPO-14), copied to add this repo's scope section. -->

# Security Policy

> How to report a vulnerability in Label Studio (`zpl-viewer`), which versions get fixes, and what the extension's security surface is.

## Supported versions

| Version | Supported |
| --- | --- |
| The latest release (or the default branch until the first release) | ✅ |
| Anything older | ❌ |

Security fixes ship as patch releases through release-please.

## Reporting a vulnerability

**Do not open a public issue.** Report privately through GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository (**Security → Report a vulnerability**), or email **amr.abdel@gmail.com**.

Please include the version or commit, what an attacker can do, and the steps to reproduce. A label file that triggers the problem is the most useful attachment.

## Response window

You will get an acknowledgement **within 7 days**. We then agree a fix timeline with you, and credit you in the advisory unless you ask us not to.

## Scope

Label Studio parses and renders label files that may come from anywhere: printer captures, other repositories, email attachments. Treat everything below as in scope.

- **Label parsing and rendering** (`src/core/`, `src/formats/`, `src/renderer/`, `src/image/`): runs in the extension host (diagnostics, SVG export) and in the preview webview. Crashes, hangs or memory exhaustion from a crafted label count.
- **Webviews** (`src/webview/`, `src/previewPanel.ts`, `src/ui/barcodeStudio.ts`): scripts load only from the extension's `dist/webview` folder under a nonce-based Content-Security-Policy, and the host accepts only a fixed set of messages from them.
- **Deployment** (`src/deploy/`): the only code that opens a socket or writes outside a save dialog. It runs only when you choose Deploy, and sends to the printer profile you pick.
- **Settings**: printer profiles and deploy options are read from VS Code settings.

Out of scope: the printers themselves, and the bundled third-party libraries (`bwip-js`, `pdf-lib`) except where Label Studio uses them unsafely; report those upstream.
