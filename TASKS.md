# RDD Implementation Roadmap

**Status:** Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅ + Phase 4 ✅ + Phase 4.5 ✅ | Phase 5 (⏳ Pending)

Last updated: 2026-05-30

---

## Phase Overview

| Phase | Name | Status | Purpose |
|-------|------|--------|---------|
| 1 | Infrastructure Base | ✅ Complete | Express server, env validation, logging, health endpoint |
| 2 | Webhook Listener | ✅ Complete | POST /webhook with HMAC validation, Google Sheets REGISTRO tab |
| 3 | Agent + Database | ✅ Complete | Claude SDK multi-turn, SQLite conversation store |
| 4 | Drive Integration | ✅ Complete | Google Drive folder management, 3-webhook lifecycle handlers |
| 4.5 | API Security Layer | ✅ Complete | CORS, Helmet, API Key auth, rate limiting |
| 5 | UI Layer | ⏳ Pending | Dashboard, conversation UI (may be external) |

---

## Phase 1: Infrastructure Base ✅

**What was built:**
- `src/config/` — Environment validation with Zod
- `src/utils/` — Logger (Pino), error handlers
- `src/api/health.ts` — GET /health endpoint
- `src/index.ts` — Express entry point with middleware
- `tests/unit/config.test.ts` + `tests/integration/health.test.ts`

**Key decisions:**
- Use Pino for structured logging (not Winston)
- Validate env at startup, fail fast
- Health endpoint returns status + timestamp

**Tests status:** ✅ 11/11 passing

**Commits:**
- 3a36cb4: CLAUDE.md Phase 1 documentation
- bf9b7c2: Phase 2 webhook listener
- 3ec9b3b: Agent Orchestration Rule 0

---

## Phase 2: Webhook Listener ✅

**What was built:**
- `src/api/webhook.ts` — POST /webhook/causa-nueva handler
- `src/sheets/client.ts` — Google Sheets JWT auth + append rows
- HMAC-SHA256 signature validation
- Payload validation (causa_id, montos, fechas)

**Key decisions:**
- Use service account for Google auth (never OAuth)
- Validate signature ALWAYS (Domain Invariant)
- Append to REGISTRO tab in Google Sheets
- Rate limit: Queue + retry with exponential backoff

**Tests status:** ✅ 11/11 passing

**Edge cases handled:**
- Invalid signature → 401 Unauthorized
- Missing required fields → 400 Bad Request
- Google Sheets timeout → 503 Service Unavailable with retry-after
- Length mismatch in crypto.timingSafeEqual → fixed with length check

**Commits:**
- bf9b7c2: Phase 2 webhook listener + tests
- 3a36cb4: CLAUDE.md Phase 1+2 status

---

## Phase 3: Agent + Database ✅

**What was built:**

### Phase 3a: SQLite Schema (✅ Complete)
- `src/database/schema.ts` — SQL DDL + TypeScript types (conversations, messages, audit_log)
- `src/database/sqlite.ts` — DB client initialization (singleton)
- `src/database/models.ts` — 10 CRUD async functions
- Tests: 20 tests, 100% pass

### Phase 3b: Multi-Turn Claude Agent (✅ Complete)
- `src/agent/claude-agent.ts` — Singleton agent, 12-step orchestration
- `src/agent/message-parser.ts` — Intent detection (5 types), financial extraction (6 formats)
- `src/agent/agent-db.ts` — 4 DB wrapper functions
- `src/api/agent.ts` — POST /agent/chat endpoint
- `src/types/agent.ts` — Zod schemas
- Tests: 45 new tests (76 total), 100% pass

**Key decisions:**
- D12-D20: See PROGRESS.md for full decision log
- SQLite for Phase 3 (switchable to Postgres in Phase 5)
- Regex-based intent parsing (Claude tool_use in Phase 4+)
- Atomic message + audit writes (Domain Invariant #4, #8)
- 429 retry with exponential backoff (DI #9)

**Test status:** ✅ 76/76 passing (45 new + 31 pre-existing)

**Blockers:** None

**Commits:**
- d9ab5ac: feat: Phase 3b Multi-Turn Claude Agent & Conversation Persistence
- e2bad94: tests: Add Phase 3b test suite (31 tests, 100% pass)

---

## Phase 4: Drive Integration ✅

**Architecture:** See [docs/FLOW-RESTRUCTURING.md](docs/FLOW-RESTRUCTURING.md) for complete flow diagram

**What was built:**

### Core Drive Infrastructure
- `src/utils/retry.ts` — Extracted retryWithBackoff utility (generic, reusable)
- `src/config/constants.ts` — DRIVE_MIME_TYPES constant (FOLDER, PDF, TEXT)
- `src/drive/client.ts` — Drive API client with folder + document operations
  - `createCaseFolder(causaId)` → /Rodado/[Causa_ID]/ with Por-Resolver/ + Resueltos/
  - `getFoldersByCase(causaId)` → retrieve folder hierarchy
  - `uploadDocument(parentFolderId, filename, content, mimeType)` → upload files
  - `listDocuments(folderId)` → list files in folder
  - All operations wrapped in `retryWithBackoff` for resilience

### 3-Webhook Lifecycle Handlers
- `POST /webhook/causa-nueva` — Creates Drive folders + registers in Sheets + creates DB conversation
  - Calls `createCaseFolder()` before Sheets append
  - Returns `drive_folder_id` and `driveFolderUrl` in response
- `POST /webhook/caso-modificacion` — Updates conversation metadata (RIT, tribunal)
  - Finds conversation by `causa_id`, updates with new metadata
  - Returns 200 with `causa_id` on success
- `POST /webhook/caso-cierre` — Closes conversation
  - Finds conversation by `causa_id`, marks as closed
  - Returns 200 with `causa_id` on success

### Database & Sheets Integration
- Updated `src/database/schema.ts` — Added `drive_folder_id?: string` to ConversationMetadata
- Updated `src/sheets/client.ts` — Added column P for `driveFolderUrl`, expanded ranges to A:P
- Updated `src/types/rdd.ts` — Added `CasoModificacionPayload`, `CasoCierrePayload`, optional `driveFolderUrl` field

### Tests
- `tests/unit/drive-client.test.ts` — 2 tests verifying module exports + function signatures
- `tests/unit/webhook.test.ts` — Updated with Drive client mocks (6 tests, 2 skipped)
- `tests/unit/webhook-modificacion.test.ts` — 6 tests covering signature validation, payload validation, DB updates
- `tests/unit/webhook-cierre.test.ts` — 6 tests covering signature validation, payload validation, conversation closure
- `tests/integration/webhook.test.ts` — 2 tests covering full webhook → Drive → Sheets → DB flow

**Test status:** ✅ 88 tests passing | 2 skipped (90 total, 11 test files)

**Key decisions:**
- **D22-D25:** See PROGRESS.md for full decision log
- Use Google Service Account for Drive auth (no OAuth)
- Retry with exponential backoff for rate limits (429) and 5xx errors
- Drive folder IDs generated by RDD, not provided by SaaS webhook
- Schema extensible for Phase 5+ (document attachment handling)

**Commits:**
- eebd548: feat: Phase 4 Drive Integration - Complete

**Not in Phase 4 scope (Phase 5+):**
- WhatsApp SDK integration (Phase 5)
- PDF attachment processing from WhatsApp (Phase 5)
- Admin dashboard / UI (Phase 5)
- Document search functionality (Phase 5)

---

## Phase 4.5: API Security Layer ✅

**What was built:**
- `src/middleware/auth.ts` — API Key authentication middleware
  - `requireApiKey(req, res, next)` validates Authorization header with Bearer token
  - Responds with 401 Unauthorized if missing/invalid
- `src/middleware/rate-limit.ts` — Dual-tier rate limiting
  - `webhookLimiter` — 100 requests/min for webhook endpoints
  - `chatLimiter` — 30 requests/min for chat endpoints
- Global Helmet middleware for HTTP security headers
- CORS middleware with configurable allowed origins

**Environment Variables Added:**
- `UI_API_KEY` — API key for frontend (min 32 chars)
- `ALLOWED_ORIGINS` — CSV of allowed CORS origins (default: http://localhost:3000)
- `WEBHOOK_RATE_LIMIT` — Requests/min for webhooks (default: 100)
- `CHAT_RATE_LIMIT` — Requests/min for chat (default: 30)

**Middleware Integration:**
- Global: Helmet → CORS → JSON parser → logger
- Webhook routes: Rate limiter (no auth, HMAC validation unchanged)
- Chat routes: API Key auth → Rate limiter

**Key decisions:**
- **D30:** API Key auth (not JWT) — simple for small internal team, no login UI needed
- **D31:** Webhooks excluded from API Key auth — use HMAC-SHA256 validation (Domain Invariant)
- **D32:** Helmet + CORS ordered before routes — security headers applied to all responses

**Tests status:** ✅ 95 tests passing | 2 skipped (97 total)

**New test files:**
- `tests/unit/auth.test.ts` — 5 tests for API Key validation
- `tests/unit/rate-limit.test.ts` — 2 tests for rate limiter exports

**Updated test files:**
- All existing test files updated with complete environment mocks (UI_API_KEY, ALLOWED_ORIGINS, rate limit vars)

**Commits:**
- 5e6fd4b: feat: Phase 4.5 API Security Layer - CORS, Helmet, API Key Auth, Rate Limiting

**Purpose:**
- Enables Phase 5 UI to call backend securely from different origin
- Protects endpoints from abuse (rate limiting)
- Adds HTTP security headers (Helmet)
- Validates frontend requests with API Key

---

## Phase 5: UI Layer (⏳ Pending)

**Scope:**
- Dashboard showing cases, conversations, documents
- Chat interface for RDD agent
- Admin panel for compliance logging

**Note:** May be built separately (external to this repo). Depends on Phase 3-4 complete.

---

## How to Use This File

1. **At session start:** Check status here + run `./scripts/init.sh`
2. **When starting Phase 3:** Copy Phase 3 section details into your task plan
3. **When completing a phase:** Update status, add commits, document decisions
4. **When blocked:** Add to Blockers section, then see PROGRESS.md for context

---

## Quick Links

- [CLAUDE.md](CLAUDE.md) — Master guide + discipline rules
- [PROGRESS.md](PROGRESS.md) — Decisions and learnings log
- [.claude/rules/](`.claude/rules/`) — Auto-loading discipline rules
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System diagrams

---

## Template: Adding Phase Progress

When you complete a phase, update it like this:

```markdown
## Phase N: [Name] ✅

**What was built:**
- Brief list of files/modules

**Key decisions:**
- Decision 1 and why
- Decision 2 and why

**Tests status:** ✅ X/Y passing

**Commits:**
- HASH: Message
```

Then move to the next phase section and update status to 🚧.
