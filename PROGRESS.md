# RDD Progress & Decision Log

This file captures major decisions, learnings, and blockers as we build RDD. Updated after each significant milestone.

---

## May 29, 2026 — Phase 1 + Phase 2 Complete

### Decisions Made

**D1: Use Pino for logging**
- Chose: Structured logging (Pino) over Winston
- Reason: Better performance, cleaner JSON output, less boilerplate
- Trade-off: Slightly heavier dependency, but worth it for production clarity
- Impact: All future logging uses Pino

**D2: Service Account ONLY for Google auth**
- Chose: No OAuth interactive flows
- Reason: Webhooks are automated, need non-interactive auth
- Trade-off: Service account requires JSON key management
- Impact: All Google API calls use service account JWT

**D3: HMAC-SHA256 signature validation mandatory**
- Chose: Every webhook is validated, no exceptions
- Reason: Domain Invariant — prevent processing fake webhooks
- Trade-off: Adds crypto overhead (minimal)
- Impact: If signature validation fails, webhook rejected at handler level

**D4: Google Sheets append-only for REGISTRO tab**
- Chose: Don't update existing rows, only append
- Reason: Audit trail clarity, prevents data loss from accidents
- Trade-off: More storage used, but worth it
- Impact: REGISTRO grows, need occasional archiving

**D5: Length check before crypto.timingSafeEqual**
- Chose: Fixed issue where mismatched signature lengths caused ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH
- Reason: crypto.timingSafeEqual requires equal-length buffers
- Trade-off: None (this is a fix, not a tradeoff)
- Impact: Signature validation no longer crashes on invalid input

### Learnings

**L1: Environment validation at startup prevents cascading failures**
- Catching missing env vars early (at startup) is better than discovering them at runtime
- Implemented: Zod schema validation in src/config/index.ts
- Future: Apply same pattern to any new config (Google API keys, etc.)

**L2: Service account JSON key is sensitive**
- Never commit .env or service account JSON to git
- Created .env.example as template
- Future: Consider encrypting sensitive keys in deployment

**L3: Webhook signature validation needs length parity**
- crypto.timingSafeEqual fails if buffers aren't equal length
- Fixed: Added length check before comparison
- Future: Document this in api-patterns.md for Phase 3 team

**L4: Test environment needs NODE_ENV setup**
- Tests were failing because process.env.NODE_ENV wasn't set
- Fixed: Created .env.test and updated vitest.config.ts
- Future: Always set up test env file for new testing layers

**L5: TypeScript strict mode catches edge cases**
- Enabled strict mode in tsconfig.json
- Caught several potential null reference issues early
- Future: Keep strict mode always on

### Blockers (None)

- Phase 1 ✅ (no blockers)
- Phase 2 ✅ (no blockers)

---

## How to Use This File

### At Session Start:
1. Read the most recent date section
2. Understand what decisions were made and why
3. Check Learnings — they apply to current work

### When Making a Decision:
1. Document it here with format: **D#: [Title]**
2. Explain why you chose it
3. Note trade-offs
4. Describe impact on future work

### When You Hit a Problem:
1. Add to Learnings section
2. Explain what you learned
3. Suggest how it changes future work

### When You Get Stuck:
1. Add to Blockers section
2. Describe what's blocking you
3. Propose next steps to unblock

---

## Decision Template

```markdown
**D#: [Decision Title]**
- Chose: [What you chose]
- Reason: [Why you chose it]
- Trade-off: [What you're giving up]
- Impact: [How this affects future work]
```

---

## May 29, 2026 — Phase 3 Architecture: Webhook Contract & RDD Integration

### Decisions Made

**D6: Three-Webhook Architecture (CREACIÓN, CIERRE, ACTUALIZACIÓN)**
- Chose: Three distinct webhooks fired from SaaS at different lifecycle points
- Reason: Matches actual case lifecycle: creation → work → closure → updates during work
- Trade-off: SaaS must implement three webhook endpoints instead of one
- Impact: RDD can track complete case journey without polling; each event triggers specific RDD action

**D7: RDD as Conversational Assistant (Not Auto-Agent)**
- Chose: User initiates chat; RDD prepares/reviews/authorizes before any external action
- Reason: Control over sensitive case data; admin must approve all client notifications
- Trade-off: No fully automatic notifications; requires admin review
- Impact: RDD is admin tool, not public chatbot; access restricted to admin + authorized staff

**D8: Demandado Info Split Between SaaS and User**
- Chose: SaaS provides (nombre, rut); User provides (abogado nombre, abogado email) in chat
- Reason: At case creation, don't know demandado's lawyer; many cases have no opposing counsel (cobranza)
- Trade-off: Abogado info only available after user provides it
- Impact: REGISTRO incomplete until user registers closure; not all cases have abogado field

**D9: Single Row per Case in REGISTRO (Not Per-Event)**
- Chose: Same REGISTRO row updated when case moves etapa (litigacion → cobranza)
- Reason: Same causa, same row; only tribunal/RIT changes as case progresses
- Trade-off: Row gets complex with multiple tribunal/RIT history (handled via historial_estados audit in SaaS)
- Impact: REGISTRO row lifecycle: created on CREACIÓN webhook, updated throughout, filled at CIERRE

**D10: Notification Pattern: Prepare → Review → Authorize**
- Chose: RDD drafts notification (email/SMS), admin reviews, admin clicks "Send"
- Reason: Notifications are critical (payment notices, case updates); admin must verify before sending
- Trade-off: Not fully automatic; requires admin action
- Impact: Admin never loses touch with client communication; clear audit trail of who authorized what

**D11: Access Control: Admin Only (No Public)**
- Chose: RDD only accessible to admin + authorized users via authentication
- Reason: Contains sensitive data (amounts, client details, case strategies, payment terms)
- Trade-off: No public/self-service access
- Impact: Requires user auth system; audit all access; clear ownership

### Learnings

**L6: Case State Machine is Complex**
- Learned: Cases can cycle (litigacion → cobranza in different tribunal with new RIT)
- Future: historial_estados in SaaS is the source of truth for all state changes; RDD must consume it
- Future: Some fields (tribunal, RIT) only exist after presentación; don't assume initial values

**L7: Domain Requires Deep Understanding**
- Learned: Labor law cases have specific lifecycle (declarativa → cobranza); demandado has no lawyer until closure
- Future: Phase 3 team must understand legal domain; not just a generic case tracker
- Future: Consult user frequently to validate assumptions about case states/transitions

### Blockers (None)

- Webhook contract defined ✅
- Data flow clarified ✅
- RDD role clarified ✅

---

## May 30, 2026 — Phase 3a: Database Layer & Schema Design (COMPLETE ✅)

### What Was Built

SQLite schema for conversation persistence across RDD's multi-turn agent workflow:
- **3-table design:** conversations (one per case), messages (per turn), audit_log (immutable trail)
- **Atomic transactions:** Message + audit log write together; rollback on failure
- **Audit logging:** Every data modification logged with who/when/what/why (Domain Invariant #8)
- **Type safety:** Full TypeScript strict mode, no `any` types, boundary handling for timestamps
- **Comprehensive testing:** 20 tests covering all 10 CRUD functions, happy paths + edge cases

### Files Created

| File | Purpose |
|------|---------|
| `src/database/schema.ts` | SQL DDL + TypeScript types |
| `src/database/sqlite.ts` | DB client initialization (singleton) |
| `src/database/models.ts` | 10 CRUD async functions |
| `tests/database/models.test.ts` | Test suite (20 tests) |
| `docs/schema-spec.md` | Complete schema specification |

### Decisions Made

**D12: SQLite over Postgres**
- Chose: SQLite with better-sqlite3
- Reason: Simpler deployment, no external service, sufficient for Phase 3 load
- Trade-off: No horizontal scaling; switchable in Phase 5 if needed
- Impact: Deployment requires no additional infrastructure; DB file lives alongside the app

**D13: JSON metadata over normalization**
- Chose: conversations.metadata and messages.metadata store case state as JSON
- Reason: Avoids schema migrations as domain evolves; provides flexibility for unknown case states
- Trade-off: No structured queries on metadata fields; acceptable for Phase 3
- Impact: Schema stays stable; new case state fields added to metadata without migrations

**D14: Audit log as append-only**
- Chose: No updates, no deletes on audit_log table
- Reason: Complete compliance trail for legal cases; tamper-evident history
- Trade-off: Table grows indefinitely; requires archiving strategy in Phase 5
- Impact: Every CRUD operation logs immutable record; admin can reconstruct all state changes

**D15: Singleton pattern for DB connection**
- Chose: `getDatabase()` caches the connection instance
- Reason: Prevents multiple open file handles and connection exhaustion
- Trade-off: Not thread-safe (acceptable: Node.js is single-threaded)
- Impact: All modules import `getDatabase()` and share the same connection

**D16: Transactional CRUD (message + audit atomically)**
- Chose: Every message write includes atomic audit log entry via `db.transaction()`
- Reason: Partial writes (message written, audit not) would break compliance trail
- Trade-off: Slightly more complex write code
- Impact: Either both write or neither writes; no orphaned messages without audit trail

### Learnings

**L8: better-sqlite3 requires vitest exclusion**
- Learned: better-sqlite3 is a native module; Vite's ESM transform breaks it
- Fixed: Added `server.deps.external: ['better-sqlite3']` to vitest.config.ts
- Future: Any native Node.js module (with .node bindings) needs same vitest exclusion

**L9: In-memory SQLite per test requires schema initialization**
- Learned: `:memory:` DB starts empty; each test must call `initDatabase()` explicitly
- Fixed: Added `beforeEach` that initializes schema and seeds test data
- Future: Always initialize schema in test setup for SQLite-based tests

**L10: TypeScript strict mode catches timestamp boundary issues**
- Learned: SQLite stores timestamps as strings; TypeScript strict mode requires explicit parsing
- Fixed: Added `new Date(row.created_at)` at all DB→TypeScript boundaries
- Future: Define all timestamp fields as `Date` in interfaces; always parse at boundary

### Validation Results

- TypeScript: strict mode, zero `any` types, all types explicit
- Domain Invariants: audit logging, atomicity, validation constraints
- Behavioral Guidelines: minimal code, surgical changes, goal-driven
- Architecture: singleton pattern, clean imports, no circular deps
- Security: parameterized SQL, env-based config, no secrets
- Performance: composite indexes, LIMIT on large queries, no N+1
- Tests: 31 total (20 new + 11 pre-existing), 100% pass rate

### Integration Points (Phase 3b)

- **Agent module** will import `getDatabase()` and models functions
- **Webhook handler** will create conversations on CREACION, messages on each webhook
- **Claude SDK** will load conversation history via `getConversationHistory()`
- **Admin dashboard** will query audit trail via `getAuditTrailForCase()`

### Blockers (None)

- Schema designed and implemented ✅
- All CRUD operations tested ✅
- TypeScript strict mode passing ✅
- Integration points defined for Phase 3b ✅

---

## Quick Links

- [TASKS.md](TASKS.md) — What phases are complete, what's next
- [CLAUDE.md](CLAUDE.md) — Discipline rules and project overview
- [.claude/rules/](.claude/rules/) — Auto-loading rules
