# Provider status

## Active core providers

- Workers AI for model calls when the `AI` binding is present.
- OpenRouter for hosted model calls.
- OpenAI-compatible endpoints for configurable model services.
- Brevo or Cloudflare Email Service for outbound replies.

## Stored but not agent capabilities

Google and GitHub credential/OAuth modules remain in the control plane for future product decisions. A stored connection does not give the model access to anything because the capability registry is empty.

Custom MCP support has been removed. Historical database migrations may mention its old tables, but there is no registration, OAuth, discovery, or dispatch implementation in the current source.

## Provider rules

Each active provider must normalize its request/response contract, bound time and output, avoid leaking secrets, and have focused tests. A future capability must not be added merely because a provider credential exists.
