# Security Policy

AFI is an early-stage local application, not a supported production service. No response-time guarantee is offered.

## Report a vulnerability privately

Please do not publish exploitable details, credentials, personal data, database exports, or backups in a public issue. If GitHub private vulnerability reporting is enabled for this repository, use:

<https://github.com/blairf932/knowfirst/security/advisories/new>

If that page is unavailable, contact the maintainer through the GitHub profile at <https://github.com/blairf932> and request a private reporting route. Share only the minimum steps and evidence needed to reproduce the issue. Do not send API keys or production data.

## Supported versions

Only the current default branch is considered for security fixes. No older release has a support or patching commitment.

## Safe testing

Use a disposable local database and test credentials. Do not test against production systems or third-party services without their authorization. Remove secrets from logs before sharing them.
