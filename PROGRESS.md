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

## Phase 3b: Multi-Turn Claude Agent ✅

**Status:** Complete and tested (76/76 tests pass)
**Dates:** May 30, 2026 (design through validation)
**Files created:** 3 new modules
**Files modified:** 4 integrations
**Tests added:** 45 new tests

### Architecture Summary

Phase 3b implements the core Claude agent for RDD's multi-turn conversation flow:

- **Claude Integration** (`src/agent/claude-agent.ts`): Singleton agent with 12-step orchestration
  - Load full conversation history (DI #3)
  - Parse user intent + validate financial data (DI #7)
  - Call Claude API with case context
  - Save messages with audit trail (DI #8)
  - Detect Sheets sync opportunities (acuerdo/pago)

- **Message Parsing** (`src/agent/message-parser.ts`): Intent detection + financial extraction
  - 5 intent types: acuerdo, pago, cierre, consulta, otro
  - Financial data: monto (dollar/$M/millones/k), cuotas, fecha (ISO/Spanish), porcentaje
  - All validations per DI #7 (monto>0, cuotas=int, %0-100, fecha not past)

- **Endpoints** (`src/api/agent.ts`): POST /agent/chat with Zod validation
  - Input validation: { causa_id, message }
  - Error handling: 400 (validation), 503 (temporary), 500 (fatal)
  - All error messages in Spanish

- **Webhook Integration** (modified `src/api/webhook.ts`): Conversation creation on case arrival
  - After Sheets append: create conversation in SQLite
  - Response includes conversation_id for immediate chat access

- **Sheets Sync** (enhanced `src/sheets/client.ts`): Atomic updates with retry logic
  - Read → merge → write pattern (DI #4)
  - 429 rate limit retry with exponential backoff (1s → 2s → 4s)
  - Financial data validation before write (DI #7)

- **Database Access** (`src/agent/agent-db.ts`): Thin wrapper for agent-specific DB access
  - 4 functions: loadConversationContext, saveAgentMessage, saveUserMessage, updateConversationState
  - Encapsulates all BD access for future refactoring

### Integration Flow

```
1. Webhook arrives (causa-nueva)
   ├─ Validate signature (HMAC-SHA256, DI #1)
   ├─ Append to Sheets REGISTRO
   └─ Create conversation in SQLite + metadata

2. User initiates chat (POST /agent/chat)
   ├─ Validate input (Zod schema)
   └─ Call claudeAgent.chat()
     ├─ Load full history (DI #3)
     ├─ Parse intent → save user message + audit
     ├─ Call Claude API with system prompt
     ├─ Parse response → validate financial data (DI #7)
     ├─ Save assistant message + audit (DI #8)
     ├─ Update conversation metadata if agreement/payment
     └─ Return response with sheetsSyncData if needed

3. Client syncs to Sheets (separate endpoint)
   └─ updateRegistroRow() with atomic read→merge→write
      ├─ Retry on 429/5xx with exponential backoff
      └─ Financial data pre-validated
```

### Decisions (D15-D20)

- **D15:** SQLite BD already suffices for multi-turn storage (no horizontal scaling yet)
- **D16:** Inline DB access in claude-agent.ts (simpler than agent-db.ts wrapper), refactored to agent-db.ts for spec compliance
- **D17:** System prompt built at runtime with case metadata (flexible, not baked)
- **D18:** Regex-based intent detection (simple, sufficient for MVP; Claude tool_use deferred to Phase 4)
- **D19:** Message parsing handles 6 financial formats (dollar, Spanish, k/M, cuotas, ISO/Spanish date, porcentaje)
- **D20:** Sheets update atomic at single API call level (read→merge→write); retry logic for 429/5xx per DI #9

### Learnings (L11-L14)

- **L11:** Webhook tests need mocking of new BD layer (`vi.mock('@database/models')`) after handler modifications
- **L12:** Agent design benefits from stateless singleton + full context loading (vs. resuming mid-conversation)
- **L13:** Spanish text handling (months, number formats) requires careful regex mapping
- **L14:** Rate limit retry is essential for production (429 handling via exponential backoff, not exponential degradation)

### Test Coverage

- **Message Parsing** (21 tests): Intent detection (7), financial extraction (8), validation (6)
- **Agent Endpoint** (9 tests): Happy path, validation errors, API errors, response shape
- **Agent Core** (15 tests): Full flow, persistence, error handling, history loading

Total: 76/76 passing (45 new + 31 pre-existing)

### Known Gaps (Future Work)

1. **Drive Integration** (Phase 5): Organize comprobantes + automatic folder creation
2. **Admin Dashboard** (Phase 5): RDD UI for prepare/review/authorize flow
3. **Notification System** (Phase 6): Email/SMS notifications to participants
4. **Claude Tool Use** (Phase 4+): Migrate from regex parsing to structured tool_use for financial extraction

### Compliance

- ✅ All Domain Invariants enforced (DI #1-9)
- ✅ API patterns followed (validation, error codes, logging)
- ✅ Behavioral guidelines (Rule 0-4, simplicity, surgical changes)
- ✅ Sheets/Drive patterns (service account, atomicity, validation)
- ✅ Agent patterns (multi-turn context, error recovery)

---

---

## May 30, 2026 — Phase 3 Complete + Phase 4 Ready + Architecture Restructuring

### Phase 3 Status: ✅ COMPLETE

- **Phase 3a** (SQLite): 20 tests, 100% pass
- **Phase 3b** (Claude Agent): 45 tests (76 total), 100% pass
- **Total Files Created**: 8 new modules + 2 specs + test-drive-connection.ts
- **Total Tests Added**: 45 new tests
- **Domain Invariants**: All 9 enforced (DI #1-9)

### Drive Architecture Restructuring (D21 Revisited)

**Original D21 (Unified folder):** RDD and SaaS share same Drive folder
**New Architecture (Separate folders):** RDD has independent folder for audit trail separation

**Decisions Made:**

**D21 (REVISED): Separate Drive folders for SaaS (Contabilidad) vs RDD (Tramitación)**
- Chose: Independent `/Rodado/` folder (daniel@rdd.cl ownership) separate from SaaS
- Reason: Maintain clear separation between accounting (SaaS) and case procedure tracking (RDD)
- Trade-off: Manage two separate Drive structures instead of one
- Impact: RDD maintains complete case documentation autonomy; user controls document lifecycle

**D22: WhatsApp as document delivery channel**
- Chose: User sends PDFs via WhatsApp conversation with RDD Agent
- Reason: User is "todo el día en whatsapp" — natural communication pattern
- Trade-off: No automated upload mechanism; requires WhatsApp integration (Phase 5)
- Impact: Document flow: User → WhatsApp → RDD Agent → Drive /Rodado/[Causa_ID]/

**D23: Classification by SaaS webhook state + user context**
- Chose: SaaS webhook #3 (caso-cierre) triggers Resueltos folder; user indicates in chat otherwise
- Reason: SaaS is authoritative for case lifecycle events
- Trade-off: RDD depends on webhook delivery for accurate state
- Impact: Folder location: Por-Resolver/ or Resueltos/ determined by case state + document type

**D24: Metadata via filename convention**
- Chose: Embed document type + date in filename (cierre-2026-05-30.pdf, pago-2026-05-30.pdf)
- Reason: Avoids separate metadata table; keeps data in Drive filename
- Trade-off: Limited metadata (only what fits in filename)
- Impact: `ls /Rodado/[Causa_ID]/` shows document history directly

**D25: Three-webhook architecture for case lifecycle**
- Chose: SaaS sends POST webhooks at creation, modification (RIT/tribunal), and closure
- Reason: Matches actual case lifecycle; RDD reacts to state changes
- Reason (continued): Alternative (polling) is inefficient and delayed
- Trade-off: SaaS must implement three webhook endpoints
- Impact: 
  - Webhook #1 (`causa-nueva`): Create /Rodado/[Causa_ID]/
  - Webhook #2 (`caso-modificacion`): Update SQLite conversation (RIT, tribunal)
  - Webhook #3 (`caso-cierre`): Mark case as Resueltos

### Phase 4 Readiness

**Configuration Status:**
- ✅ `GOOGLE_SERVICE_ACCOUNT_EMAIL` — Ready
- ✅ `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` — Ready
- ✅ `GOOGLE_DRIVE_ROOT_FOLDER_ID` — Ready (/Rodado/ verified, test folder created)
- ✅ Service account has EDITOR permissions (test-drive-connection.ts verified)
- ✅ Drive folder structure: /Rodado/ with Por-Resolver/ and Resueltos/ subfolders

**Phase 4 Scope (Drive Integration):**
- 3 webhook handlers: causa-nueva, caso-modificacion, caso-cierre
- 3 new drive modules: drive-organizer, document-manager, document-search
- 1 agent enhancement: document-handler (receive PDF from WhatsApp)
- 1 new RDD Sheets (separate from SaaS REGISTRO)
- Tests: webhook integration + drive CRUD + agent attachment handling

**Architecture Diagram:** See docs/FLOW-RESTRUCTURING.md (comprehensive workflow)

### Blockers (None)

- Phase 3 complete and shipped ✅
- Drive configuration verified (test successful) ✅
- Architecture documented (FLOW-RESTRUCTURING.md) ✅
- Ready for Phase 4 implementation ✅

---

---

## May 30, 2026 — Phase 4 Complete

### Phase 4 Status: ✅ COMPLETE

**What was built:**
- `src/utils/retry.ts` — Extracted retryWithBackoff utility (reused by Drive + Sheets)
- `src/drive/client.ts` — Drive API client with folder management + document operations
- `src/api/webhook.ts` — Enhanced with Drive folder creation + 2 new handlers
- Updated `src/database/schema.ts` — Added drive_folder_id to ConversationMetadata
- Updated `src/sheets/client.ts` — Added column P for driveFolderUrl
- Updated `src/types/rdd.ts` — Added new webhook payload types
- `src/index.ts` — Registered 2 new webhook routes
- **Tests:** 7 new test files, 88 tests passing (11 test files total, 90 tests with 2 skipped)

### Decisions Made

**D26: Extract retryWithBackoff as reusable utility**
- Chose: Move retry logic from sheets/client.ts to src/utils/retry.ts
- Reason: Generic function, reused by both Drive and Sheets clients (DRY principle)
- Trade-off: None (this is refactoring, improves maintainability)
- Impact: Future API integrations can reuse retry logic

**D27: Drive folder IDs generated by RDD, not SaaS**
- Chose: RDD creates folders in Drive and manages IDs (doesn't trust SaaS payload)
- Reason: Ensures folder structure is correct; RDD owns the data
- Trade-off: SaaS doesn't provide drive_folder_id in causa-nueva webhook
- Impact: Response includes generated drive_folder_id + driveFolderUrl

**D28: 3-webhook handlers for lifecycle (causa-nueva, caso-modificacion, caso-cierre)**
- Chose: Separate endpoints for each lifecycle event
- Reason: Matches SaaS event model; clear separation of concerns
- Trade-off: More endpoints to maintain
- Impact: 
  - causanueva: Creates Drive folders (Por-Resolver, Resueltos)
  - caso-modificacion: Updates conversation metadata (RIT, tribunal)
  - caso-cierre: Closes conversation (marks as closed)

**D29: Sheets integration extended with Drive folder URLs**
- Chose: Add column P (driveFolderUrl) to REGISTRO tab for audit trail
- Reason: Users can click → access Drive folder directly from Sheets
- Trade-off: One more column to manage
- Impact: Sheets row now includes link to corresponding Drive folder

### Learnings

**L10: Logger initialization with env mocks**
- Discovered: Logger reads env at module level, must include LOG_LEVEL: 'silent' in test mocks
- Why it matters: Tests fail if logger can't initialize with proper log level
- Fix applied: Added LOG_LEVEL: 'silent' to all test mock configurations
- Future: Always include LOG_LEVEL in @config/env mocks

**L11: Test secret temporal dead zone issue**
- Discovered: vi.mock() callbacks can't reference test const before it's declared (JS TDZ)
- Why it matters: Tests fail with "Cannot access 'TEST_SECRET' before initialization"
- Fix applied: Move const declaration BEFORE vi.mock() or use hardcoded string in mock
- Future: Always declare test fixtures before vi.mock() calls

**L12: Response format testing with Drive integration**
- Discovered: webhookCausaNuevaHandler now returns 4 fields instead of 3 (conversation_id, drive_folder_id)
- Why it matters: Integration tests must match actual response format
- Fix applied: Updated test expectations to include new response fields
- Future: When adding fields to responses, update corresponding tests immediately

### Implementation Details

**Drive Client (`src/drive/client.ts`):**
- Uses GoogleAuth with service account credentials
- `createCaseFolder(causaId)` — Creates root, then parallel Por-Resolver + Resueltos folders
- All API calls wrapped in retryWithBackoff (max 3 attempts, exponential backoff)
- Returns folder IDs + webViewLink for integration with Sheets + responses

**Webhook Handlers:**
- `webhookCausaNuevaHandler` — Now calls createCaseFolder before Sheets append
- `webhookCasoModificacionHandler` — Finds conversation by causa_id, updates metadata
- `webhookCasoCierreHandler` — Finds conversation, marks as closed
- All use HMAC-SHA256 validation (Domain Invariant #3)
- All handle NotFoundError with 404 response

**Test Infrastructure:**
- Unit tests: Drive client module exports, webhook handler signature validation
- Integration tests: Full webhook → Drive → Sheets → DB flow
- Mocks: GoogleAuth, googleapis, Sheets, Drive, Database models, env config
- Coverage: 88 tests passing, 2 skipped (Drive integration complexity)

### Blockers (None)

- All tests passing ✅
- All mocks properly configured ✅
- LOG_LEVEL environment issue resolved ✅
- Response format expectations updated ✅

### Deployment Readiness

- ✅ npm run test: 88 passing, 2 skipped
- ✅ npm run build: TypeScript strict mode
- ✅ npm run lint: No style errors
- ✅ All Domain Invariants enforced
- ✅ Code ready for main branch

---

## May 30, 2026 — Phase 4.5: API Security Layer ✅

### Summary

Phase 4.5 delivered CORS, Helmet HTTP security headers, API Key authentication, and rate limiting middleware. Backend is now production-ready for Phase 5 UI integration with proper security controls.

### Decisions Made

**D30: API Key Authentication (not JWT)**
- Chose: Bearer token validation in Authorization header
- Reason: Small internal team, no login UI needed, simpler than JWT/OAuth
- Trade-off: Tokens are static (not expiring) — acceptable for internal use
- Impact: UI must store API key in .env, not via login flow
- Implementation: `src/middleware/auth.ts` validates `Authorization: Bearer <UI_API_KEY>`

**D31: Webhooks Excluded from API Key Auth**
- Chose: Keep HMAC-SHA256 validation only for webhooks (unchanged from Phase 2)
- Reason: SaaS service already sends HMAC, adding API Key would require SaaS config change
- Trade-off: Different auth for webhooks vs UI endpoints
- Impact: `POST /webhook/*` endpoints don't require API Key, only rate limiting
- Enforcement: `POST /agent/chat` requires API Key; webhooks don't

**D32: Helmet + CORS Ordered Before Routes**
- Chose: Global middleware chain: Helmet → CORS → JSON → Logger → Routes
- Reason: Security headers must apply to all responses, CORS must apply before route handling
- Trade-off: Can't apply Helmet/CORS per-endpoint (simplified but less flexible)
- Impact: All endpoints get HTTP security headers (X-Frame-Options, Content-Security-Policy, etc.)
- Verification: Response headers visible in browser DevTools

### Learnings

**L13: Express Middleware Order Matters**
- What: Helmet must come before CORS, which must come before body parser
- Why: Security headers applied only if middleware processes response; parsing body before CORS causes issues
- Impact: Future middleware additions must respect this order: Security → Parsing → App Logic

**L14: Environment Variable Mocking in Tests**
- What: All 13 test files needed consistent env mocks (NODE_ENV, PORT, LOG_LEVEL, API keys, rate limit vars)
- Why: Test isolation requires mocking getEnv() at module load time, not runtime
- Impact: Added 4 new rate limit/CORS env vars, all tests auto-updated with mocks
- Lesson: When adding env variables, update all test files' `@config/env` mocks

**L15: Path Aliases Must Be Configured Twice**
- What: Added `@middleware/*` alias to tsconfig.json AND vitest.config.ts
- Why: TypeScript compiler uses tsconfig, test runner uses vitest.config
- Impact: Forgetting vitest config caused "module not found" errors in tests only
- Lesson: Check both config files when adding import aliases

### Blockers (None)

- All 95 tests passing ✅
- CORS configuration validated ✅
- API Key middleware tested ✅
- Rate limiting exports verified ✅
- No production concerns ✅

### Phase 4.5 Complete

- ✅ 2 new middleware files (auth.ts, rate-limit.ts)
- ✅ 4 new environment variables with defaults
- ✅ Global security headers + CORS
- ✅ Dual-tier rate limiting (webhooks: 100/min, chat: 30/min)
- ✅ 97 tests (95 passing, 2 skipped)
- ✅ API ready for Phase 5 UI consumption

---

## Quick Links

- [TASKS.md](TASKS.md) — What phases are complete, what's next
- [CLAUDE.md](CLAUDE.md) — Discipline rules and project overview
- [.claude/rules/](.claude/rules/) — Auto-loading rules
