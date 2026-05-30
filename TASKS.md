# RDD Implementation Roadmap

**Status:** Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅ | Phase 4 (🚧 Ready for Implementation)

Last updated: 2026-05-30

---

## Phase Overview

| Phase | Name | Status | Purpose |
|-------|------|--------|---------|
| 1 | Infrastructure Base | ✅ Complete | Express server, env validation, logging, health endpoint |
| 2 | Webhook Listener | ✅ Complete | POST /webhook with HMAC validation, Google Sheets REGISTRO tab |
| 3 | Agent + Database | 🚧 In Planning | Claude SDK multi-turn, SQLite conversation store |
| 4 | Drive Integration | ⏳ Pending | Google Drive API wrapper, file upload/download |
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

## Phase 4: Drive Integration (🚧 Ready for Implementation)

**Architecture:** See [docs/FLOW-RESTRUCTURING.md](docs/FLOW-RESTRUCTURING.md) for complete flow diagram

**What needs to be built:**

### Webhook Handlers (3 total)
- `src/api/webhook.ts` — Update to handle 3 webhook events:
  1. `POST /webhook/causa-nueva` — Create /Rodado/[Causa_ID]/ with subfolders
  2. `POST /webhook/caso-modificacion` — Update SQLite (RIT, tribunal, cambios)
  3. `POST /webhook/caso-cierre` — Change status to Resueltos in SQLite + Sheets

### Drive Modules (3 modules)
- `src/drive/drive-organizer.ts` — Folder CRUD: create, delete, list by cause
- `src/drive/document-manager.ts` — Upload PDFs to correct folder (Por-Resolver or Resueltos)
- `src/drive/document-search.ts` — Find documents by causa_id, tipo, etapa

### Agent Enhancement
- `src/agent/document-handler.ts` — Process PDF attachments from WhatsApp
  - Detect document type (cierre, pago, otro)
  - Save with metadata filename (cierre-2026-05-30.pdf)
  - Confirm with user before saving

### Data Layer
- New Google Sheet (RDD REGISTRO) — Separate from SaaS Sheets
  - Columns: Causa_ID, Demandado, Etapa_Actual, Documentos_En_RDD, Fecha_Actualización
  - Append-only for audit trail (same pattern as Phase 2)
  - Updated when documents arrive or status changes

**Key decisions (Resolved):**
- **D22:** WhatsApp for document delivery (not email/upload)
- **D23:** SaaS webhook #3 determines Resueltos status
- **D24:** Metadata via filename (type-date.pdf)
- **D25:** 3-webhook architecture for lifecycle events
- See PROGRESS.md for full decision details

**Tests needed:**
- Webhook integration: 3 handlers + state transitions
- Drive operations: create folder, upload file, search
- Agent attachment handling: receive PDF, classify, save
- RDD Sheets: append-only, audit trail

**Not in Phase 4 scope (Phase 5+):**
- WhatsApp SDK integration (Phase 5)
- Admin dashboard / UI (Phase 5)
- Notification system (Phase 6)
- Cloud deployment (Phase 6)

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
