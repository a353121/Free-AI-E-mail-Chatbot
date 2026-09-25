# Admin control plane

`/admin` manages the model, email delivery, runtime safety, encrypted secrets, sender approval, and sender data. It does not manage tools or custom MCP connections.

The current capability count is intentionally zero. The Admin UI has no capability catalog, tool toggles, MCP form, or MCP OAuth controls. Runtime limits remain available because they protect the core model and email pipeline; they do not enable external actions.

## Authentication

Admin login uses a PBKDF2 password hash, a signed Secure/HttpOnly session cookie, CSRF tokens, login throttling, and a restrictive response CSP. Production bootstrap:

```bash
npm run admin:hash
npx wrangler secret put ADMIN_PASSWORD_HASH
npx wrangler secret put ADMIN_SESSION_SECRET
npm run db:migrate
```

Application secrets use AES-256-GCM with a key derived from `ADMIN_SESSION_SECRET`. Secret values are never returned to the browser.

## Core views

- Overview: model, bindings, active capability count, guard state, and compaction health.
- AI & prompts: model provider, model identity, endpoint, and system instructions.
- Email flow: delivery and sender settings.
- Runtime safety: budgets, context caps, rate limits, compaction, and guardrails.
- Senders: approval, suspension, blocking, deletion, and redacted details.
- Secrets: encrypted provider credentials and optional provider OAuth connections.

Legacy operational routes such as `/tools`, `/mcp`, `/usage`, `/runs/*`, and `/conversations` remain disabled and return `410` where applicable.
