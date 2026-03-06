# 🤖 AI E-mail Chatbot (Cloudflare Worker + OpenRouter + Brevo)

<p align="center">
  <a href="https://workers.cloudflare.com/"><img src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" /></a>
  <a href="https://developers.cloudflare.com/workers/runtime-apis/handlers/email/"><img src="https://img.shields.io/badge/Cloudflare-Email%20Routing-0EA5E9" alt="Cloudflare Email Routing" /></a>
  <a href="https://openrouter.ai/"><img src="https://img.shields.io/badge/OpenRouter-LLM%20Gateway-7C3AED" alt="OpenRouter" /></a>
  <a href="https://www.brevo.com/"><img src="https://img.shields.io/badge/Brevo-SMTP%20API-22C55E" alt="Brevo" /></a>
  <a href="https://developers.cloudflare.com/kv/"><img src="https://img.shields.io/badge/Cloudflare-KV%20Memory-2563EB" alt="Cloudflare KV" /></a>
  <img src="https://img.shields.io/badge/Runtime-Node.js%20ESM-3C873A" alt="Node.js ESM" />
  <img src="https://img.shields.io/badge/Status-Production%20Ready-success" alt="Status" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

> **Turn incoming e-mails into an AI conversation thread automatically.**  
> This Worker receives e-mails, cleans quoted content, maintains per-sender conversation memory in KV, generates a response with OpenRouter, and replies through Brevo.

---

## 💸 Fully Free to Run

This project is designed to run **entirely on free tiers**, making it possible to deploy a working AI email assistant **without any hosting cost**.

It relies on the following free limits:

- **Cloudflare Workers:** up to **100,000 requests per day** on the free plan  
- **Brevo free plan:** up to **300 transactional emails per day**  
- **OpenRouter:** uses the **`openrouter/free` model endpoint**, which provides free access to supported community models

As long as your usage stays within these limits, the system can run **completely free**.

---

## ✨ What this project does

When an e-mail is received:

1. **Filters by subject keyword** (`openrouter`) to avoid triggering on every inbox event.
2. **Parses raw MIME e-mail** content using `postal-mime`.
3. **Cleans quoted/replied text** so the model sees only the latest user intent.
4. **Loads memory** (last 15 Q&A turns) from Cloudflare KV per sender address.
5. **Optionally injects a global system prompt** from KV key: `SYSTEM_INSTRUCTIONS`.
6. **Calls OpenRouter** Chat Completions API.
7. **Stores the new turn** back into KV.
8. **Replies by e-mail** to the original sender via Brevo.

---

## 🧠 Architecture (at a glance)

```text
Incoming Email
   │
   ▼
Cloudflare Email Worker (src/index.js)
   ├─ Parse MIME (postal-mime)
   ├─ Clean message body
   ├─ Load/update per-user memory (Cloudflare KV)
   ├─ Optional system instructions (KV key: SYSTEM_INSTRUCTIONS)
   ├─ Call OpenRouter /chat/completions
   └─ Send response via Brevo SMTP API
```

---

## 🔐 Environment variables & configuration

Use **Wrangler secrets** for sensitive values.

### Required runtime bindings

- `CHAT_MEMORY` (Cloudflare KV namespace binding)

### Required environment variables

| Variable | Required | Description |
|---|---:|---|
| `OPENROUTER_API_KEY` | ✅ | API key for OpenRouter |
| `BREVO_API_KEY` | ✅ | API key for Brevo transactional email |
| `SENDER_NAME` | ✅ | Display name used for outbound e-mail sender |
| `SENDER_EMAIL` | ✅ | Verified sender e-mail address in Brevo |

### Optional KV keys

| Key | Purpose |
|---|---|
| `SYSTEM_INSTRUCTIONS` | Global system prompt prepended to every conversation |

---

## 🚀 Quick start

### 1) Clone and install

```bash
git clone <your-public-repo-url>
cd AI-E-mail-Chatbot
npm install
```

### 2) Authenticate Wrangler

```bash
npx wrangler login
```

### 3) Create KV namespace (once)

```bash
npx wrangler kv namespace create CHAT_MEMORY
```

Copy the returned namespace `id` into `wrangler.toml` under:

```toml
[[kv_namespaces]]
binding = "CHAT_MEMORY"
id = "<YOUR_KV_NAMESPACE_ID>"
```

### 4) Set secrets (recommended)

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put SENDER_NAME
npx wrangler secret put SENDER_EMAIL
```

### 5) Deploy

```bash
npx wrangler deploy
```

---

## 📮 Cloudflare Email Routing setup

1. Add/verify your domain in Cloudflare.
2. Enable **Email Routing**.
3. Create a route that forwards an address (e.g. `ai@yourdomain.com`) to this Worker.
4. Send a test message with `openrouter` in the subject (current trigger condition).

---

## 🧪 Local development & logs

Run locally:

```bash
npx wrangler dev
```

Tail production logs:

```bash
npx wrangler tail
```

---

## ⚙️ Behavior details

- **Subject gate:** only e-mails whose subject contains `openrouter` (case-insensitive) are processed.
- **Memory window:** max **15 turns** (30 message objects) per sender.
- **Quoted text cleanup:** removes common quoted thread fragments (`\n--\n` and `>` lines).
- **Model call:** uses OpenRouter endpoint `POST /api/v1/chat/completions` with `model: openrouter/free`.
- **Response channel:** sends plain-text reply through Brevo API.

---

## 🛡️ Security checklist

- [ ] **Never commit real API keys** in `wrangler.toml`.
- [ ] Move all secrets to Wrangler secrets (`wrangler secret put ...`).
- [ ] Keep sender address/domain verified in Brevo.
- [ ] Use Cloudflare account-level permissions with least privilege.

---

## 🧩 Suggested `wrangler.toml` template (public-safe)

```toml
name = "ai-e-mail-chatbot"
main = "src/index.js"
compatibility_date = "2025-01-01"

[[kv_namespaces]]
binding = "CHAT_MEMORY"
id = "<YOUR_KV_NAMESPACE_ID>"

[vars]
SENDER_NAME = "AI E-mail Chatbot"
SENDER_EMAIL = "ai@yourdomain.com"
```

> Put all sensitive values using `wrangler secret put`, not in git-tracked files.

---

## 📚 References

- https://workers.cloudflare.com/  
- https://developers.cloudflare.com/email-routing/  
- https://developers.cloudflare.com/kv/  
- https://openrouter.ai/  
- https://www.brevo.com/  
- https://www.npmjs.com/package/postal-mime  

---

## 📄 License

This project is licensed under the **MIT License**.

See the full license here:  
[LICENSE](./LICENSE)
