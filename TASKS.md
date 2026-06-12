# RDD Implementation Roadmap

**Status:** Phases 1–6.5 ✅ + Phase 7 ✅ + Phase 8.1 ✅ + Phase 8.2 ✅ + Phase 9.1 ✅ + Phase 9.2 ✅ + Phase 9.3 ✅ | Feature-complete — Next: Production Readiness Roadmap (Etapas 1–5)

Last updated: 2026-06-11

**Roadmap activo:** [docs/superpowers/plans/2026-06-11-production-readiness.md](docs/superpowers/plans/2026-06-11-production-readiness.md)

---

## Phase Overview

| Phase | Name | Status | Purpose |
|-------|------|--------|---------|
| 1 | Infrastructure Base | ✅ Complete | Express server, env validation, logging, health endpoint |
| 2 | Webhook Listener | ✅ Complete | POST /webhook with HMAC validation, Google Sheets REGISTRO tab |
| 3 | Agent + Database | ✅ Complete | Claude SDK multi-turn, SQLite conversation store |
| 4 | Drive Integration | ✅ Complete | Google Drive folder management, 3-webhook lifecycle handlers |
| 4.5 | API Security Layer | ✅ Complete | CORS, Helmet, API Key auth, rate limiting |
| 5 | UI Layer | ✅ Complete | React + Vite dashboard, chat interface, API integration |
| 5.1 | GET /cases Endpoint | ✅ Complete | List conversations endpoint, Dashboard case selection UI |
| 5.2 | WebSocket Real-Time Chat | ✅ Complete | Token streaming, socket.io, real-time message rendering |
| 5.3 | Supabase Migration | ✅ Complete | SQLite → PostgreSQL, message persistence, timing-safe auth |
| 5.4 | Advanced Search UI | ✅ Complete | Hardcoded case states, colored badges, filter param tests |
| 6.1 | Financial Data Model | ✅ Complete | Supabase tables (acuerdos, cuotas, registros), ±5 day tolerance |
| 6.2 | Agent Supabase Integration | ✅ Complete | Chat writes acuerdos/pagos/cobranzas to Supabase |
| 6.3 | Analytics API | ✅ Complete | /analytics/* endpoints for portfolio KPIs, income, agreements, results |
| 6.4 | Portfolio UI | ✅ Complete | React components for cartera dashboard with charts and tables |
| 6.5 | Portfolio Chat | ✅ Complete | REST endpoint /agent/portfolio-chat, PortfolioChatWindow UI, multi-turn history |
| 7 | Manual Financial Entry | ✅ Complete | POST /financials/registro + Case Detail View (GET /analytics/case/:causaId) |
| 8.1 | Agent Tool Use | ✅ Complete | 5 tools (create_acuerdo, create_registro, mark_cuota_pagada, get_caso_estado, close_case), tool-use loop en chat() y chatStream() |
| 8.2 | Intent from Tool Use | ✅ Complete | Intent y shouldSyncSheets derivados de resultados de Tool Use (no hardcoded) |
| 9.1 | Schema Redesign + Webhook State Contract | ✅ Complete | case_state binario (activa\|cerrada) + motivo_cierre, handlers caso-etapa y caso-cierre con sub_etapa enum |
| 9.2 | Proactive Acuerdo Detection | ✅ Complete | pending_action flag + inyección de ACCIÓN PENDIENTE en system prompt |
| 9.3 | pending_action en caso-etapa | ✅ Complete | Extiende pending_action a webhookCasoEtapaHandler para sub_etapa Acuerdo |
| E1–E5 | Production Readiness | 📋 Planned | Ver [roadmap de producción](docs/superpowers/plans/2026-06-11-production-readiness.md): robustez crítica, CI/CD, deuda técnica, outbox Sheets, deploy VPS |

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

## Phase 5: UI Layer ✅

**What was built:**
- `ui/` folder — React 19 + Vite project with TypeScript + Tailwind
- `ui/src/components/Dashboard.tsx` — Causa ID entry, defaults to manual input
- `ui/src/components/ChatWindow.tsx` — Multi-turn chat interface with message history
- `ui/src/services/api.ts` — HTTP client for /agent/chat endpoint with API key auth
- `ui/src/App.tsx` — Router between Dashboard and ChatWindow
- Environment configuration and Vite dev server proxy

**Key decisions:**
- D32: React + Vite in same repo (not separate) for unified deployment
- D33: React 19 + TypeScript + Tailwind CSS stack
- D34: API Key (Bearer token) authentication, matching backend

**Tests status:** ✅ No unit tests for Phase 5 (focus on E2E manual testing)

**Commits:**
- d2e83b1: feat: Phase 5 UI Layer - React + Vite Dashboard and Chat Interface

---

## Phase 5.1: GET /cases Endpoint ✅

**What was built:**
- `src/database/models.ts` — Added `listConversations()` function
- `src/api/cases.ts` — New `casesHandler` endpoint
- `src/index.ts` — Registered `GET /cases` route
- `ui/src/services/api.ts` — Added `getCases()` function
- `ui/src/components/Dashboard.tsx` — Enhanced with case list UI
- `tests/unit/cases.test.ts` — 6 unit tests for endpoint

**Key decisions:**
- D35: GET /cases endpoint for better UX (list instead of manual input)

**Tests status:** ✅ 6 new tests + 97 existing (all passing)

**Purpose:**
- Users see list of active cases on Dashboard load
- Click to select case instead of typing causa_id
- Fallback: Manual input still available

---

## Phase 5.2: WebSocket Real-Time Chat ✅

**Status:** ✅ **PRODUCTION READY** — Full implementation, all tests passing, builds successful

**What was built:**
- `src/agent/claude-agent.ts` — Added `chatStream()` method with token streaming via `messages.stream()`
- `src/api/socket-handler.ts` — Socket.io event handlers (join_case, send_message, leave_case)
- `src/index.ts` — Refactored to `http.createServer(app)` + attach SocketIOServer
- `src/types/agent.ts` — Socket event interfaces (SocketJoinCasePayload, etc.)
- `ui/src/services/socket.ts` — Singleton socket.io-client with lifecycle management
- `ui/src/types/socket.ts` — Frontend socket event interfaces (duplicate types for client)
- `ui/src/components/ChatWindow.tsx` — Replaced HTTP sendMessage with socket.emit + streaming bubble
- `ui/vite.config.ts` — Added `/socket.io` proxy with `ws: true`
- `tests/unit/socket-handler.test.ts` — 11 tests covering all handlers, error cases

**Key decisions:**
- **D36:** socket.io v4 (not raw ws) — auto-reconnect, rooms, fallback to polling
- **D37:** Streaming via `messages.stream()` — token-by-token feedback vs full response
- **D38:** Socket auth via `join_case` with same API_KEY as HTTP auth
- **D39:** processingMap guard — prevents concurrent send_message from same socket
- **D40:** socket.connected check on token callback — safe disconnect handling

**Socket Protocol:**
- Client: `join_case { causaId, apiKey }` → Server validates, socket joins room
- Client: `send_message { causaId, message }` → Server calls `chatStream()`, emits tokens
- Server: `message_token { token }` × N → incremental text bubbles
- Server: `message_complete { assistantMessage, intent, shouldSyncSheets, timestamp }` → finalize
- Server: `error { code, message }` → auth_failed, not_in_room, validation_error, stream_error

**Verification (May 30, 3:10 PM):**
- ✅ TypeScript: `npm run type-check` — zero errors
- ✅ Backend build: `npm run build` — successful
- ✅ Frontend build: `npm run build` in ui/ — 239.82 KB → 75.32 KB gzip
- ✅ Tests: 112/112 passing (11 new socket + 101 existing)
- ✅ Linting: clean

**Backward Compatibility:**
- All 101 existing tests continue to pass
- `chat()` method and `POST /agent/chat` endpoint untouched
- HTTP sendMessage() still available as fallback
- Tests import handlers directly, never `src/index.ts` — safe refactor

**User Experience:**
- Messages no longer wait for full response — tokens appear incrementally
- No polling needed — real-time streaming via WebSocket
- Typing effect: user sees Claude's response as it's generated
- No page refresh required

**Next Phase:** Phase 5.3 (Advanced Search) — optional; users can search by client name, RUT, or RIT

---

## Phase 5.3: Supabase Migration & Advanced Search ✅

**Status:** ✅ **PRODUCTION READY** — Full implementation, all tests passing (106/106, 100% pass rate)

**What was built:**
- `src/database/supabase.ts` — Supabase client singleton (replaces SQLite)
- `src/database/schema.ts` — Updated TypeScript interfaces with searchable columns
- `src/database/models.ts` — Refactored queries to use Supabase PostgREST API
- Enhanced webhook handlers — now persist `cliente_nombre`, `cliente_rut`
- `src/middleware/auth.ts` — Timing-safe API key validation with `crypto.timingSafeEqual()`
- `tests/agent/claude-agent.test.ts` — Refactored message mock with functional state passing
- Message persistence — proper filtering, ordering, and limiting

**Key decisions:**
- **D8:** SQLite → Supabase PostgreSQL for production workload
- **D9:** Functional parameter passing in query mock (not global state) to prevent test race conditions
- **D10:** Timing-safe comparison for API key validation (security hardening)

**Security improvements:**
- ⚠️ → ✅ API key validation: Fixed timing attack vulnerability
  - Before: Direct string comparison (`providedKey !== expectedKey`)
  - After: Constant-time comparison using `crypto.timingSafeEqual()`
  - Impact: Resistant to timing-based key guessing attacks

**Test improvements:**
- Message mock: Proper insert/select flow distinction
- Query chaining: All methods available at every stage (eq, order, limit, single)
- Filter state: Functional parameter passing prevents concurrent test interference
- Database state: insertedMessages array for proper persistence tracking

**Test status:** ✅ **106/106 passing** (15 test files, 2 skipped)
- claude-agent.test.ts: All 5 previously failing tests now pass
- models.test.ts: All database operations verified
- socket-handler.test.ts: WebSocket handlers functional
- All integration tests passing

**Verification (May 30, 8:10 PM):**
- ✅ TypeScript: `npm run type-check` — zero errors
- ✅ Build: `npm run build` — successful
- ✅ Tests: 106/106 passing (100% pass rate)
- ✅ Linting: clean
- ✅ Endpoints: all APIs functional (health, webhook, agent, cases, socket)
- ✅ Security: timing-safe API key validation deployed

**Key commits:**
- 0b5b1ae: fix: Resolve 5 failing tests + security vulnerabilities
  - Fixed message persistence in agent tests
  - Implemented timing-safe API key validation
  - Refactored message mock with local filter/order state
  - All 106 tests passing, zero TypeScript errors

**Learnings captured:**
- See PROGRESS.md L8-L12 for full technical details
- Mock testing patterns for PostgREST APIs
- Functional state passing for concurrent test safety
- Timing attack vulnerability and mitigation

**Next Phase:** Phase 5.4 (Advanced Search UI) — Dashboard search by client name, RUT, tribunal, case state

---

## Phase 5.4: Advanced Search UI ✅

**What was built:**
- `ui/src/components/Dashboard.tsx` — CASE_STATES constant (hardcoded all 5 states), getCaseStateStyle helper, colored case state badges
- `tests/unit/cases.test.ts` — 6 new filter param forwarding tests (q, tribunal, etapa, case_state, from/to, limit/offset)

**Key decisions:**
- D11: Hardcode CASE_STATES instead of deriving from loaded data (see PROGRESS.md)
- D12: Add color-coded badges for case states (see PROGRESS.md)

**Test status:** ✅ 112/112 passing (6 new tests added)

**TypeScript:** Zero errors

**Commits:**
- 6439066: Phase 5.4 - Advanced Search UI completion

**Learnings captured:**
- See PROGRESS.md L13-L15 for full context
- Why hardcoding filter options is better than deriving from data
- Importance of test coverage for API param forwarding
- UI/UX improvements for case state visibility

**Status:** Production ready. All search, filter, and sort functionality fully tested and implemented.

---

## Phase 6.1: Financial Data Model ✅

**What was built:**
- `src/database/schema.ts` — 3 new Supabase tables: acuerdos, cuotas, registros
- Supabase SQL DDL executed (CREATE TABLE + GRANTs for service_role)
- See PROGRESS.md D13-D15 for architectural decisions

**Database Schema:**
- `acuerdos` — Agreement headers (monto_total, cuotas_total, fecha_primer_pago, estado)
- `cuotas` — Individual installment rows (numero, monto, fecha_vencimiento, fecha_pago, estado)
- `registros` — One-off cobranza/sentencia/gasto records (tipo, monto, fecha, notas)

**Key decisions:**
- D13: Supabase as authoritative source for NEW financial data (Sheets = legacy)
- D14: Three-table model (acuerdos + cuotas) for normalized agreement tracking
- D15: Estado column + calculated vencida derivation in queries

**Tests status:** ✅ 112/112 passing (no new tests; Fase 6.3 adds analytics endpoint tests)

**Verification:**
- ✅ Tables exist in Supabase: SELECT * FROM information_schema.tables WHERE table_schema='public'
- ✅ GRANTs executed: service_role has ALL permissions

**Commits:**
- TBD: Awaiting test suite completion

---

## Phase 6.2: Agent Supabase Integration ✅

**What was built:**
- `src/database/models.ts` — 5 new functions:
  - `createAcuerdo(data)` — INSERT acuerdos + returns id
  - `createCuotas(acuerdoId, cuotas[])` — Batch INSERT with calculated dates
  - `createRegistro(data)` — INSERT cobranza/sentencia/gasto
  - `markCuotaPagada(acuerdoId, numeroCuota, fechaPago)` — UPDATE with estado logic
  - `getAcuerdosActivos(conversationId)` — SELECT for active agreements

- `src/agent/claude-agent.ts` — `executeSuperparserAction()` function
  - Detects intent (acuerdo | pago)
  - Calls appropriate DB function based on context
  - Integrated into chat() and chatStream() methods

- `src/agent/claude-agent.ts` — `calculateCuotaDates()` helper
  - Generates array of monthly vencimiento dates
  - Handles month wrapping correctly

**Key decisions:**
- D13-D15: See Fase 6.1 decisions
- Atomic operations: All cuotas created in batch or not at all
- Payment status derivation: Determined at write time (>5 days = pagada_con_retraso)

**Integration:**
- Chat intent 'acuerdo' → createAcuerdo + createCuotas
- Chat intent 'pago' + active agreements → markCuotaPagada
- Chat intent 'pago' + no agreements → createRegistro (cobranza/sentencia)
- Webhook (causas-nueva) still syncs to Sheets; Sheets updates now deprecated for chat

**Tests status:** ✅ 112/112 passing (no new failures introduced)

**TypeScript:** ✅ zero errors

**Files Modified:**
- src/database/models.ts — Added 5 new functions
- src/agent/claude-agent.ts — Added executeSuperparserAction() + calculateCuotaDates()
- src/index.ts — (no changes needed)

**Commits:**
- TBD: Awaiting test suite completion

---

## Phase 6.3: Analytics API ✅

**What was built:**
- `src/database/analytics-queries.ts` — 4 query helpers
  - `getCartKPI()` — Year-to-date + month + acuerdos + cuotas vencidas + % result
  - `getIncomeData(from, to)` — Monthly breakdown + by-source percentages
  - `getAcuerdosStatus()` — Active agreements with cuota progress
  - `getCaseResults()` — Counters per case state (activas, desistidas, caducadas)

- `src/api/analytics.ts` — 4 REST endpoints
  - `GET /analytics/cartera` → KPI resumen
  - `GET /analytics/ingresos?from=2026-01&to=2026-05` → Income time-series
  - `GET /analytics/acuerdos` → Agreement status table
  - `GET /analytics/resultados` → Case outcome counters

- `src/index.ts` — Registered routes with requireApiKey middleware

**Implementation Status:**
- ✅ analytics-queries.ts created
- ✅ analytics.ts created (4 handlers)
- ✅ routes registered in index.ts
- ✅ npm run build: zero errors
- ✅ 112/112 tests passing

**Key Decisions (see PROGRESS.md):**
- D13: Supabase as authoritative source for new financial data
- D14: Three-table model (acuerdos + cuotas + registros)
- D15: Cuota estado derived at write time (±5 day tolerance)

---

## Phase 6.4: Portfolio UI ✅

**What was built:**
- `ui/src/components/Cartera.tsx` — Main portfolio view orchestrator
  - Loads KPI + income + acuerdos + resultados in parallel
  - Tab navigation (Ingresos | Acuerdos | Resultados)
  - Error handling + refresh button

- `ui/src/components/cartera/KPICards.tsx` — 5 KPI cards
  - Cobrado este año (blue)
  - Cobrado este mes (green)
  - Acuerdos activos (purple)
  - Cuotas vencidas (red if > 0)
  - % Resultados (orange)

- `ui/src/components/cartera/IngresosTab.tsx` — Income visualization
  - Stacked bar chart (monthly: cobranza+sentencia+acuerdo)
  - Horizontal bar breakdown by source (%)
  - Uses Recharts for charts

- `ui/src/components/cartera/AcuerdosTab.tsx` — Agreement status table
  - Columns: Causa, Monto, Cuotas (pagadas/total), Próx. Vencimiento, Vencidas, Estado
  - Color-coded status badges (al_día=green, con_retraso=yellow, vencido=red)
  - Responsive table with hover states

- `ui/src/components/cartera/ResultadosTab.tsx` — Case statistics
  - 5 cards: Con Resultado, Sin Resultado, Desistidas, Caducadas, Activas
  - Percentage breakdown
  - Distribution bars

- `ui/src/services/api.ts` — Extended with analytics functions
  - `getCartera()` → CarteraKPI
  - `getIngresos()` → IncomeData
  - `getAcuerdos()` → AcuerdoStatus[]
  - `getResultados()` → CaseResults

- `ui/src/App.tsx` — App-level navigation refactored
  - Top-level tabs: Causas | Cartera
  - View state machine (causas, cartera, chat)
  - Handlers for navigation between views

**Dependencies Installed:**
- recharts (41 packages added, 611 total)

**Implementation Status:**
- ✅ All 5 components created
- ✅ API service functions added
- ✅ App.tsx navigation updated
- ✅ npm run build (UI): zero errors
- ✅ npm run build (backend): zero errors
- ✅ 112/112 tests passing

**Key Decisions (see PROGRESS.md):**
- D16: Recharts for lightweight chart library
- D17: Tabbed navigation at App level

**Learnings (see PROGRESS.md):**
- L18: Recharts Tooltip requires type casting for strict mode
- L19: App-level view state cleaner than nested conditionals
- L20: Fixed Dashboard.tsx useRef type issue (incidental cleanup)

---

## Phase 6.5: Portfolio Chat ✅

**What was built:**
- `src/types/agent.ts` — Added PortfolioAgentResponse interface
- `src/agent/claude-agent.ts` — New `portfolioChat()` method with buildPortfolioSystemPrompt()
- `src/api/agent.ts` — New `portfolioChatHandler` with Zod validation for POST /agent/portfolio-chat
- `src/index.ts` — Registered POST /agent/portfolio-chat with requireApiKey middleware
- `ui/src/services/api.ts` — Added `portfolioChat()` function + PortfolioChatResponse type
- `ui/src/App.tsx` — Extended AppView type to include 'portfolio-chat', added navigation handlers
- `ui/src/components/Cartera.tsx` — Added onOpenChat prop + "Consultar a Rodado" button
- `ui/src/components/PortfolioChatWindow.tsx` — New component for portfolio chat UI with multi-turn support

**Implementation Details:**
- `portfolioChat()` creates/reuses synthetic `__portfolio__` conversation row for persistent history
- Fetches all 4 analytics endpoints in parallel (getCartKPI, getIncomeData, getAcuerdosStatus, getCaseResults)
- Formats analytics data into readable KPI summary in system prompt (not conversation turns)
- REST endpoint (not Socket.io): simple HTTP POST with optional conversation_id for multi-turn
- PortfolioChatWindow: message UI mirrors ChatWindow; uses fetch + state management for conversation tracking

**Key Decisions (see PROGRESS.md):**
- D18: Portfolio conversation uses shared `__portfolio__` row (single DB row for all portfolio queries)
- D19: REST transport (not Socket.io) for read-heavy portfolio queries
- D20: Analytics context in system prompt (full snapshot at query time, not incremental)

**Tests Status:** ✅ 112/112 passing (no new test files; handler behavior covered by integration patterns)

**TypeScript:** Zero errors (build verified)

**Learnings (see PROGRESS.md):**
- L21: portfolioChat mirrors chat() architecture but simplified (no intent/financial extraction)
- L22: View state machine in App.tsx scales cleanly to 4+ views
- L23: Synthetic conversation row pattern enables shared multi-turn history

**Implementation Status:**
- ✅ Backend: portfolioChat method, handler, route registration
- ✅ Frontend: App navigation, Cartera button, PortfolioChatWindow component
- ✅ API: /agent/portfolio-chat endpoint with validation
- ✅ Tests: 112/112 passing, build zero errors
- ✅ Manual testing: Endpoint callable with valid analytics context in system prompt

---

## Phase 7: Manual Financial Entry + Case Detail View ✅

**What was built:**
- `POST /financials/registro` — entrada manual de registros financieros (validación Zod: UUID, enum tipo, monto positivo)
- `GET /analytics/case/:causaId` — vista de detalle de caso con acuerdos/cuotas/registros

**Commits:**
- 17b174d: feat: Phase 7 — Manual Financial Entry + Case Detail View

---

## Phase 8.1: Agent Tool Use ✅

**What was built:**
- `src/agent/tool-definitions.ts` — 5 tool schemas: create_acuerdo, create_registro, mark_cuota_pagada, get_caso_estado, close_case
- `src/agent/tool-handlers.ts` — processToolUseBlocks() con persistencia en Supabase
- Tool-use loop agentic en `chat()` y `chatStream()` (claude-agent.ts)
- System prompt declara tools explícitamente (resuelve B6: Agent Confidence Gap)

**Key decisions:**
- Tools como enhancement, no reemplazo de parseUserIntent (rollback trivial) — ver PROGRESS.md
- L26/L27: capacidades del agente deben ser explícitas (tools + system prompt)

**Tests status:** ✅ tool-handlers.test.ts (816 LOC) + tool-use.integration.test.ts (569 LOC)

**Commits:** 32192da, d6b3c71, 701dcd4, 4195de8, 4d88d98, b8fe8f2, e2a65d6, c506629

---

## Phase 8.2: Intent Derived from Tool Use ✅

**What was built:**
- Intent y `shouldSyncSheets` derivados de qué tools ejecutó Claude (create_acuerdo → 'acuerdo', mark_cuota_pagada → 'pago', close_case → 'cierre'), con fallback a parseUserIntent() para casos sin tools
- Aplicado en `chat()` y `chatStream()`

**Commits:**
- 286a6f8: feat: Phase 8.2 — derive intent and shouldSyncSheets from Tool Use results

---

## Phase 9.1: Schema Redesign + Webhook State Contract ✅

**What was built:**
- Modelo de estado binario: `case_state` (activa|cerrada) + `motivo_cierre` (pago_total|desistimiento|caducada)
- `POST /webhook/caso-etapa` — nuevo handler: mapea etapa SaaS (Litigacion|Cobranza) a dominio RDD
- `POST /webhook/caso-cierre` actualizado: sub_etapa enum (Acuerdo|Pago|Desistimiento|Caducada) con lógica asimétrica — Acuerdo NO cierra el caso
- close_case tool alineado al nuevo modelo

**Tests status:** ✅ 164/164 passing (webhook-etapa.test.ts, webhook-cierre.test.ts ampliados)

**Commits:** fce2e1d, 127bf9b y relacionados

---

## Phase 9.2: Proactive Acuerdo Detection ✅

**What was built:**
- Campo `pending_action` en schema de conversations
- webhook caso-cierre setea `pending_action='ask_acuerdo_terms'` en eventos Acuerdo
- System prompt inyecta sección ACCIÓN PENDIENTE para que el agente pregunte términos del acuerdo proactivamente

**Commits:**
- c53eebb: feat: Phase 9.2 — Proactive Agent Detection of Cierre/Acuerdo

---

## Phase 9.3: pending_action en caso-etapa ✅

**What was built:**
- `webhookCasoEtapaHandler` también setea `pending_action` cuando sub_etapa_nueva='Acuerdo' (consistencia entre ambos entry points)

**Tests status:** ✅ 187 tests passing (2 skipped), build 0 errors, lint 0 errors

**Commits:**
- 290ab79: feat: Phase 9.3 — extend pending_action to webhookCasoEtapaHandler

---

## Etapas 1–5: Production Readiness Roadmap 📋

**Plan completo:** [docs/superpowers/plans/2026-06-11-production-readiness.md](docs/superpowers/plans/2026-06-11-production-readiness.md)

| Etapa | Contenido | Estado |
|-------|-----------|--------|
| 0 | Baseline: push, docs sincronizados | ✅ (2026-06-11, commit c537382) |
| 1 | Robustez crítica: error handlers globales, /health/ready, idempotencia webhooks, PM2 | ✅ (2026-06-11) |
| 2 | Pipeline de deploy: CI GitHub Actions, migraciones versionadas, DEPLOYMENT.md | ✅ (2026-06-12) CI + DEPLOYMENT.md + deploy.sh + db/migrations con baseline |
| 3 | Calidad: 0 lint warnings, TDs, request ID logging | ✅ (2026-06-12) lint 0 warnings con gate en CI, TDs cerrados, request ID en logs |
| 4 | Confiabilidad flujo de ingresos: outbox Sheets, auditoría E2E financiera, Fase 10 Session Digest | ✅ (2026-06-12) outbox + worker, brecha updateRegistroRow cerrada, GET /agent/digest |
| 5 | Salida a producción: VPS, Nginx/HTTPS, webhooks reales JPourney, smoke tests | 📋 |

**⚠️ BLOCKER B7 (ver PROGRESS.md):** el proyecto Supabase configurado ya no existe (NXDOMAIN).
Antes de la Etapa 5 hay que crear un proyecto nuevo, aplicar `db/migrations/0001_baseline.sql`
y actualizar `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.

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
