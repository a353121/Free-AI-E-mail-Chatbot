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

1. **Filters by configurable subject trigger** (default: `startsWith` on `[ai]`) to avoid triggering on every inbox event.
2. **Recognizes reset commands** when the subject contains `reset` in any casing and clears that sender's saved memory while keeping the KV key.
3. **Parses raw MIME e-mail** content using `postal-mime`.
4. **Cleans quoted/replied text** so the model sees only the latest user intent.
5. **Loads memory** (last 15 Q&A turns) from Cloudflare KV per sender address.
6. **Optionally injects a global system prompt** from KV key: `SYSTEM_INSTRUCTIONS`.
7. **Calls OpenRouter** Chat Completions API.
8. **Stores the new turn** back into KV.
9. **Replies by e-mail** to the original sender via Brevo.

---

## 🧠 Architecture (at a glance)

```text
Incoming Email
   │
   ▼
Cloudflare Email Worker (src/index.js)
   ├─ Orchestrate inbound message flow
   ├─ Delegate body cleanup to src/email/*
   ├─ Delegate memory access to src/history/store.js
   ├─ Delegate model calls to src/providers/openrouter.js
   └─ Delegate outbound delivery to src/providers/brevo.js
```

---

## 🧱 Module layout

```text
src/
├─ index.js                  # Worker entrypoint: orchestration + top-level error handling
├─ shared.js                 # Plain-text normalization and shared constants
├─ email/
│  ├─ normalizeBody.js       # Inbound plain-text / HTML cleanup
│  ├─ subject.js             # Reply-subject generation
│  ├─ threading.js           # Message-ID / References helpers
│  └─ triggers.js            # Subject trigger normalization + matching
├─ history/
│  └─ store.js               # KV history normalization, loading, clearing, and persistence
└─ providers/
   ├─ openrouter.js          # OpenRouter request / response handling
   └─ brevo.js               # Brevo SMTP API delivery
```

When adding features, prefer extending one of these focused modules or introducing a new peer module rather than expanding `src/index.js`.

---

## 🔐 Environment variables & configuration

Use **Cloudflare Worker secrets** for sensitive values. Keep only non-secret defaults in `wrangler.toml`.

### Required runtime bindings

- `CHAT_MEMORY` (Cloudflare KV namespace binding)

### Required environment variables

| Variable | Required | Description |
|---|---:|---|
| `OPENROUTER_API_KEY` | ✅ | API key for OpenRouter |
| `BREVO_API_KEY` | ✅ | API key for Brevo transactional email |
| `SENDER_NAME` | ✅ | Display name used for outbound e-mail sender |
| `SENDER_EMAIL` | ✅ | Verified sender e-mail address in Brevo |
| `SUBJECT_TRIGGER` | Optional | Subject text to match after normalization; defaults to `[ai]` |
| `SUBJECT_TRIGGER_MODE` | Optional | Matching mode: `contains`, `startsWith`, or `exact` |

### Optional KV keys

| Key | Purpose |
|---|---|
| `SYSTEM_INSTRUCTIONS` | Global system prompt prepended to every conversation |

---

## 🚀 Quick start

### 1) Clone and install

```bash
git clone https://github.com/a353121/free-ai-e-mail-chatbot.git
cd free-ai-e-mail-chatbot
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

### 4) Configure `wrangler.toml` with non-secret values

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
SUBJECT_TRIGGER = "[ai]"
SUBJECT_TRIGGER_MODE = "startsWith"
```

### 5) Add secrets

Use either method below for **only** the secret values:

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put BREVO_API_KEY
```

### 6) Deploy from the CLI

```bash
npx wrangler deploy
```

### 7) Deploy from the Cloudflare dashboard

If you prefer not to use the Wrangler CLI for deployment:

1. Fork or import `https://github.com/a353121/free-ai-e-mail-chatbot` into your own GitHub account.
2. In the Cloudflare dashboard, go to **Workers & Pages** → **Create** → **Import a repository**.
3. Connect GitHub if prompted, then select your forked repository.
4. Keep the Worker entrypoint as `src/index.js`.
5. Add the KV namespace binding so `CHAT_MEMORY` points to your namespace.
6. In **Settings** → **Variables and Secrets**, add these plain-text variables:
   - `SENDER_NAME`
   - `SENDER_EMAIL`
   - `SUBJECT_TRIGGER`
   - `SUBJECT_TRIGGER_MODE`
7. In the same screen, add these as **secrets**:
   - `OPENROUTER_API_KEY`
   - `BREVO_API_KEY`
8. Save, deploy, and then connect Cloudflare Email Routing to the Worker.

### 8) Customize the subject trigger without editing code

Update `wrangler.toml` or set environment-specific vars to change how inbound subjects are matched:

```toml
[vars]
SUBJECT_TRIGGER = "[support]"
SUBJECT_TRIGGER_MODE = "startsWith"
```

Examples:

- `SUBJECT_TRIGGER = "[ai]"` with `SUBJECT_TRIGGER_MODE = "startsWith"` matches `[ai] Draft this`.
- `SUBJECT_TRIGGER = "ask ai"` with `SUBJECT_TRIGGER_MODE = "contains"` matches `Weekly update - ask ai for summary`.
- `SUBJECT_TRIGGER = "assistant"` with `SUBJECT_TRIGGER_MODE = "exact"` matches only `assistant` after normalization.

---

## 📮 Cloudflare Email Routing setup

1. Add/verify your domain in Cloudflare.
2. Enable **Email Routing**.
3. Create a route that forwards an address (for example `ai@yourdomain.com`) to this Worker.
4. Send a test message whose subject starts with `[ai]`, or send a message with `reset` anywhere in the subject to clear stored history for that sender.

---

## 🧪 Local development & logs

```bash
npx wrangler dev
npm test
npm run test:watch
npx wrangler tail
```

---

## ⚙️ Behavior details

- **Subject gate:** inbound subjects are lowercased, trimmed, repeated spaces are collapsed, and reply/forward prefixes such as `Re:` / `Fwd:` are stripped before matching.
- **Trigger config:** `SUBJECT_TRIGGER` selects the text to match, and `SUBJECT_TRIGGER_MODE` chooses `contains`, `startsWith`, or `exact`.
- **Reset command:** if the subject contains `reset` in any casing, the sender's saved chat history is replaced with an empty array so the KV key remains present while memory is cleared.
- **Memory window:** max **15 turns** (30 message objects) per sender.
- **Quoted text cleanup:** removes common quoted thread fragments (`\n--\n` and `>` lines).
- **Model call:** uses OpenRouter endpoint `POST /api/v1/chat/completions` with `model: openrouter/free`.
- **Response channel:** sends a plain-text reply through Brevo API.

---

## 🛡️ Security checklist

- [ ] Never commit real API keys in `wrangler.toml`.
- [ ] Keep only non-secret defaults in `[vars]`.
- [ ] Put `OPENROUTER_API_KEY` and `BREVO_API_KEY` in Cloudflare secrets.
- [ ] Keep sender address/domain verified in Brevo.

---

## 🌿 Public branch workflow

To maintain a public clone safely:

1. Keep your private branch for internal experimentation.
2. Maintain a public-safe branch such as `public-release` that contains source, tests, docs, and placeholder config values.
3. Do **not** include live secrets, private keys, or production-only identifiers in that branch.
4. Push the sanitized branch to `https://github.com/a353121/free-ai-e-mail-chatbot`.

This repository is now structured for that workflow because `wrangler.toml` contains only placeholder, non-secret values.

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
SUBJECT_TRIGGER = "[ai]"
SUBJECT_TRIGGER_MODE = "startsWith"
```

> Put all sensitive values in Cloudflare Worker secrets, not in git-tracked files.
