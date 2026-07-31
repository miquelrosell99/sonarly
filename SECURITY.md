# Security Policy

## Supported versions

Only the latest commit on the `main` branch is supported with security updates. Because Sonarly is pre-1.0, we do not maintain separate release branches.

## Reporting a vulnerability

If you discover a security issue in Sonarly, please report it privately rather than opening a public issue.

Send details to **miquelrosell99@gmail.com** with:

- A clear description of the vulnerability.
- Steps to reproduce.
- Affected version or commit hash.
- Any suggested mitigation or fix.

We aim to acknowledge reports within 48 hours and provide a timeline for a fix within one week.

## Security practices

- Session cookies are `HttpOnly` and `SameSite=Strict`. Set `SESSION_COOKIE_SECURE=true` only when running behind HTTPS.
- Passwords are hashed with bcrypt. Subsonic credentials are encrypted at rest.
- API keys for OpenSubsonic clients are stored as hashes.
- File paths are validated before organization/ingest operations.
- Keep your `SESSION_SECRET` strong and unique per deployment.

## Disclosure policy

We follow coordinated disclosure. Once a fix is released, we will publish a summary in the changelog and credit the reporter unless they prefer to remain anonymous.
