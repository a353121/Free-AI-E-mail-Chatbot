# Fan-out harness

Same-Worker fan-out remains as a signed, replay-protected harness for a future capability. The current registry is empty, so no email path dispatches to `/_internal/tool`.

The retained endpoint verifies an HMAC over the exact JSON body, a timestamp, a request ID, sender ownership, and a one-time D1 replay record. It fails closed when D1 or the signing secret is unavailable.

The deployment variables `TOOL_FANOUT_MODE`, `TOOL_FANOUT_URL`, and `TOOL_FANOUT_SECRET` are compatibility settings only. They do not activate a capability or create an external action path by themselves.

Before fan-out can become active, a specific capability must be registered with a schema, ownership rule, side-effect policy, timeout, output bound, audit event, and end-to-end tests.
