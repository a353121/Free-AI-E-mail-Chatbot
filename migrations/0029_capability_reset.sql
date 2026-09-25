-- Capability reset: the agent ships with an empty tool surface.
-- Future capabilities must be added deliberately with code, policy, and tests.
UPDATE settings SET value = '' WHERE key IN ('tools_enable', 'tools_disable', 'tools_default_surface');
UPDATE settings SET value = '{"support":{"keywords":["help","broken","issue","bug","fails","not working","error","support"],"tone":"helpful and direct","surface":[]},"info":{"keywords":["what","who","where","when","how","please explain","tell me","summarize","status","update"],"tone":"informative","surface":[]},"action":{"keywords":["calculate","create","check","fetch","convert","send","prepare","build","generate","diff"],"tone":"actionable","surface":[]},"personal":{"keywords":["remember","my","i like","i prefer","forget","about me"],"tone":"warm and concise","surface":[]}}' WHERE key = 'intents';
UPDATE mcp_servers SET enabled = 0;
