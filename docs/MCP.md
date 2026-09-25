# MCP status

MCP has been removed from the product baseline. There is no custom MCP registration, discovery, OAuth, testing, editing, or dispatch path.

The historical migrations may contain old MCP tables because migrations are forward-only. Migration `0029_capability_reset.sql` disables stored registrations. Existing rows are inert data and are not exposed through Admin, the user portal, or the agent.

If MCP is ever reconsidered, it must be introduced as a new reviewed capability with a narrow contract, explicit ownership, confirmation rules, SSRF protection, bounded output, and regression tests.
