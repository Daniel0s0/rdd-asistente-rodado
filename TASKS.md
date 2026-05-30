# RDD Implementation Roadmap

**Status:** Phase 1 ✅ + Phase 2 ✅ + Phase 3 ✅ | Phase 4 (🚧 In Planning)

Last updated: 2026-05-29

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

## Phase 4: Drive Integration (⏳ Pending)

**Scope:**
- Google Drive API wrapper
- Create folder structure: `/[Cliente]/[DEMANDADO]/`
- Upload comprobantes, contratos, acuerdos
- Link Drive files to conversation

**Key decisions (TBD):**
- How do we auto-create folder structure?
- Who can upload files? (RDD agent only or users?)
- How do we prevent name collisions?

**Blockers:**
- Depends on Phase 3 (need agent to know what to upload)

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
