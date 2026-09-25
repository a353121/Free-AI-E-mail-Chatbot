# User portal

The user portal handles magic-link authentication, private conversation history, inbound attachment references, provider credentials, security history, and account deletion. It has no tool-policy controls and no custom MCP controls.

An approved sender signs in at `/login`; the Worker sends a single-use link through the durable outbox and redirects the verified session to `/account`. Pending, declined, suspended, and deleted senders cannot invoke the model.

## Core routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/login` | GET | Sign-in form |
| `/login/request` | POST | Request a magic link |
| `/login/verify?token=...` | GET | Consume a one-time token |
| `/account` | GET | Portal UI |
| `/user/api/me` | GET | Account state and sessions |
| `/user/api/providers` | GET | Redacted provider connections |
| `/user/api/providers/:provider` | PUT/DELETE | Save or remove a provider connection |
| `/user/api/history` | GET/DELETE | Search or delete owned history |
| `/user/api/history/:id` | GET/DELETE | Read or delete one conversation |
| `/user/api/history/export` | GET | Bounded JSON export |
| `/user/api/files/:id` | GET/DELETE | Owner-checked attachment access |

Unknown `/user/api/mcp/*` and `/user/api/tools/*` paths are not implemented.

## Data boundaries

D1 stores the complete transcript. R2 stores only short-lived inbound attachment objects when configured. Download paths are signed, expire quickly, require the authenticated owner session, and never expose the R2 key. Account deletion removes user-owned files, conversations, provider connections, sessions, tokens, rate events, outbox rows, and derived work.

Magic links expire after 15 minutes and are stored only as SHA-256 token hashes. User sessions expire after 30 days and are revoked on suspension or deletion.
