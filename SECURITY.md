# Security policy

## Supported version

Only the latest commit on `main` is supported during this prototype phase.

## Reporting a vulnerability

Do not publish secrets, private data, or a working exploit in a public issue.
Use GitHub's private vulnerability reporting flow from the repository
**Security** tab when it is available. If it is unavailable, open a minimal
issue asking the repository owner for a private contact channel without
including sensitive details.

Include the affected commit, reproduction conditions, impact, and the smallest
safe proof needed to confirm the problem.

## Current trust boundary

The browser game intentionally has no runtime network client, filesystem
access, desktop/native bridge, model-provider integration, telemetry exporter,
or external font resolver. Its page policy sets `connect-src 'none'`, and CI
scans source and production output for forbidden connection paths.

Any proposal that changes this boundary requires a separate security review,
explicit owner approval, visible connected/disconnected states, validation of
all inbound data, and independent disconnect tests.
