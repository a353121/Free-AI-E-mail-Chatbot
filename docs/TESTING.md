# Testing and verification

The merge gate is:

```bash
npm run verify
git diff --check
```

`npm run verify` runs TypeScript validation and the Node test suite. The tests cover email normalization and triggers, D1 history ownership, subject-based identity, conservative token accounting, token/byte context fitting, FTS5 and LIKE history recall, internal history-search dispatch, non-destructive compaction queueing, model request shaping, delivery behavior, Admin/auth primitives, user sessions, URL safety, the empty capability registry, schema validation, and disabled legacy routes.

## Baseline invariants

- `allTools` is empty.
- Configuration cannot invent or enable a capability.
- The Admin UI has no capability catalog or custom remote-server form.
- The user portal has no tool-policy or custom remote-server controls.
- Old MCP routes have no handlers.
- A normal email run calls the model with zero external tools and persists the reply.
- A normal email run exposes no external tools; private history search is the only harness-internal operation and is bounded per email.
- The complete transcript remains in D1 when summaries are created.
- `npm run db:migrate:local` applies the current forward migrations and validates the FTS5 schema in local D1.

Future capability tests must include its schema, ownership, side-effect policy, provider failure modes, output bounds, audit behavior, and end-to-end email path before registration.
