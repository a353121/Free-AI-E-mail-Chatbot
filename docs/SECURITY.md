# Security model

The current trust boundary is deliberately small: inbound email, model output, provider responses, stored user data, and optional inbound attachments. There are no active external-action tools or custom MCP connections.

## Core controls

- D1-backed sender approval and ownership are mandatory for email processing.
- Duplicate message claims, signed sessions, CSRF checks, rate limits, and daily usage guards protect state-changing paths.
- Email and model content are bounded before entering the model context.
- Secrets are encrypted with AES-256-GCM and never returned to browsers or logs.
- R2 attachment access is owner-checked and signed with short-lived URLs.
- Legacy operational endpoints return `410`; Admin and account APIs require their respective authenticated sessions.
- The capability registry is empty, so configuration cannot cause external calls.

## No active remote tool boundary

Custom MCP registration, discovery, OAuth, and dispatch have been removed. Historical MCP migrations are retained only for forward-only database history; migration `0029_capability_reset.sql` disables old rows. There is no URL-fetch capability in the baseline.

## Prompt injection

Inbound email, stored history, attachments, and provider responses are data, not policy. The response loop keeps untrusted-content instructions in the system context and scans future tool results. The model cannot elevate its own permissions because only registered capabilities can execute, and none are registered.

## Incident response

1. Preserve the run ID, sender, timestamp, and bounded error from logs.
2. Disable or rotate the affected model, delivery, or provider secret.
3. Block the sender or revoke sessions when account abuse is suspected.
4. Inspect D1 audit/run state and the email outbox.
5. Keep the registry empty while investigating; reintroduce a capability only through reviewed code and tests.
