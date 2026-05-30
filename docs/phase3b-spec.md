# Phase 3b Specification: Claude Agent Integration & Multi-Turn Conversation

## Executive Summary

Phase 3b introduces the core Claude Agent module to RDD, enabling multi-turn conversations for legal case management. This specification defines:

- **ClaudeAgent singleton** — stateless wrapper around Anthropic SDK
- **POST /agent/chat endpoint** — orchestrates conversation flow
- **Message parsing system** — extracts intent and financial data
- **Webhook integration** — creates conversations on case creation
- **Sheets sync layer** — atomically updates REGISTRO tab on agreements/payments
- **Database access patterns** — enforces conversation history loading

All code follows existing patterns in `src/api/webhook.ts`, `src/database/models.ts`, and uses `better-sqlite3` transactions for atomicity.

---

## 1. AGENT MODULE ARCHITECTURE

**File: `src/agent/claude-agent.ts`**

Core Claude integration with singleton pattern, multi-turn context loading, intent parsing, and Sheets sync orchestration. Key methods:

- `getInstance()` — Singleton factory
- `async chat(causaId, userMessage)` — Main orchestration:
  1. Load conversation from BD
  2. Load full message history (DI #3)
  3. Parse user intent
  4. Save user message (atomic)
  5. Call Claude API
  6. Parse assistant response
  7. Validate financial data (DI #7)
  8. Save assistant message (atomic)
  9. Update conversation metadata if needed
  10. Return structured response with Sheets sync data

Private helpers:
- `buildSystemPrompt()` — Case context, instructions for data extraction
- `parseAssistantResponse()` — Extract intent, look for [DATOS EXTRAIDOS], [CIERRE]
- `determineResponseType()` — Classify response (confirmation, ask_clarification, error, summary)
- `extractFlags()` — Pull warnings from response
- `buildSheetsSyncData()` — Format update for Sheets

Error classes: `ValidationError`, `ClaudeAPIError`, `TemporaryError`

---

## 2. API ENDPOINT

**File: `src/api/agent.ts`**

HTTP handler for `POST /agent/chat`:

```
Request: { causa_id: string, message: string }
Response: { success: bool, data: AgentResponse, timestamp: ISO }
Errors: 400 (validation), 503 (temporary), 500 (internal)
```

Validates input with Zod schema, calls `claudeAgent.chat()`, returns structured response. Handles specific error types with appropriate status codes.

Register in `src/index.ts`:
```typescript
import { agentChatHandler } from '@api/agent';
app.post('/agent/chat', agentChatHandler);
```

---

## 3. WEBHOOK MODIFICATIONS

**File: `src/api/webhook.ts` (after appendRegistroRow)**

Add conversation creation:
```typescript
const conversation = await createConversation(causaId, {
  demandado: causa.demandado,
  tribunal: causa.tribunal,
  rit: causa.rit,
  etapa: 'litigacion',
});
```

Returns 201 with `conversation_id` and `message: "Causa registrada. ¿Cuál es el resultado?"`

---

## 4. MESSAGE PARSING

**File: `src/agent/message-parser.ts`**

Three core functions:

- `parseUserIntent(message)` → 'acuerdo' | 'pago' | 'cierre' | 'consulta' | 'otro'
  - Detects keywords: acuerdo, pago, archivo, terminado, cuotas, monto patterns

- `extractFinancialData(message)` → { monto?, cuotas?, fecha?, porcentajeHonorarios? }
  - Regex patterns:
    - Monto: `$1,800,000` or `1.8 millones` or `1800k`
    - Cuotas: `12 cuotas`, `en 12 meses`
    - Fecha: `2026-06-30` or `30 junio 2026`
    - Porcentaje: `20%` or `20 por ciento`

- `validateFinancialData(data)` → throws ValidationError if:
  - monto ≤ 0 or > 1B
  - cuotas not int or > 360
  - porcentaje not 0-100
  - fecha in past or invalid

---

## 5. SHEETS SYNC LOGIC

**File: `src/sheets/client.ts` (new method)**

`async updateRegistroRow(causaId, updates)` → atomically updates REGISTRO row:

1. Find row by causaId (column A)
2. Read current row
3. Merge current + updates
4. Write back in single call

Handles errors: 404 (row not found), 429 (rate limit), auth errors

---

## 6. DATABASE ACCESS LAYER

**File: `src/agent/agent-db.ts`**

Three wrapper functions:

- `loadConversationContext(causaId, maxTurns)` → { conversation, recentMessages }
- `saveAgentMessage(conversationId, message, metadata)` → Message
- `saveUserMessage(conversationId, message, metadata)` → Message
- `updateConversationState(conversationId, updates)` → Conversation

Thin wrappers around models.ts functions for agent-specific access.

---

## 7. TYPES & CONSTANTS

**File: `src/types/agent.ts`**

Zod schemas for validation:

```typescript
IntentSchema = z.enum(['acuerdo', 'pago', 'cierre', 'consulta', 'otro'])
FinancialExtractionSchema = { monto?, cuotas?, fecha?, porcentajeHonorarios? }
AgentResponseSchema = { conversationId, messageId, assistantMessage, intent, extractedData, flags, shouldSyncSheets, sheetsSyncData? }
AgentChatRequestSchema = { causa_id, message }
```

---

## 8. INTEGRATION FLOW

**Webhook → Conversation → Chat → Sheets**

```
1. SaaS sends POST /webhook/causa-nueva with signature
   ↓ (validate signature, validate payload)
2. Append to Sheets REGISTRO tab
   ↓
3. CREATE conversation in SQLite (DI #3 context ready)
   ↓
4. User sends POST /agent/chat { causa_id, message }
   ↓ (validate input)
5. Load conversation + FULL history (max 10 turns)
   ↓
6. Parse user intent (acuerdo/pago/cierre/consulta)
   ↓
7. Save user message (atomic + audit)
   ↓
8. Build message array (history + new message)
   ↓
9. Call Claude API with system prompt
   ↓
10. Parse response (intent, [DATOS EXTRAIDOS], [CIERRE])
    ↓ (validate financial data per DI #7)
11. Save assistant message (atomic + audit)
    ↓
12. Update conversation metadata if agreement/payment
    ↓
13. Return response + sheetsSyncData if needed
    ↓
14. Client calls separate Sheets endpoint to sync
    ↓ (atomic read → merge → update)
```

---

## 9. ERROR HANDLING

**Claude API errors:**
- 429 → TemporaryError (rate limited)
- 5xx → TemporaryError (server error)
- 401/403 → ClaudeAPIError (auth)
- 400 → ValidationError (bad request)

**DB errors:**
- UNIQUE constraint → ValidationError (already exists)
- FOREIGN KEY constraint → ValidationError (not found)

**Sheets errors:**
- 401/403 → Error (auth failed)
- 404 → ValidationError (row not found)
- 429 → TemporaryError (rate limit)
- 5xx → TemporaryError (server error)

---

## 10. TESTING STRATEGY

**Unit Tests:**
- `src/agent/message-parser.test.ts` — parseUserIntent, extractFinancialData, validateFinancialData
- 20+ tests covering:
  - Intent detection (acuerdo, pago, cierre, consulta, fallback)
  - Monto extraction (dollar, Spanish, k/M formats)
  - Cuotas extraction (Spanish variations)
  - Fecha extraction (ISO + Spanish)
  - Porcentaje extraction
  - Validation constraints

**Integration Tests:**
- `src/api/agent.test.ts` — POST /agent/chat endpoint
- 10+ tests covering:
  - Valid request → success
  - Missing fields → 400
  - Empty message → 400
  - Claude API error → 500
  - Full flow with mocked Claude

**Test Database:**
- Use `:memory:` SQLite for test isolation
- Create test conversation with createConversation()
- Mock Claude SDK responses
- Verify messages saved + audit logged

---

## 11. COMPLIANCE CHECKLIST

| Domain Invariant | Phase 3b Implementation | How |
|------------------|------------------------|-----|
| DI #1: Webhook Signature | Validated in webhook.ts | HMAC-SHA256 timingSafeEqual() |
| DI #3: Multi-Turn Context | Loaded in claude-agent.ts | getRecentMessages(limit=CLAUDE_MAX_CONTEXT_TURNS) |
| DI #4: Sheets Atomicity | updateRegistroRow() | Read current → merge → single update call |
| DI #7: Financial Validation | validateFinancialData() | monto>0, %0-100, cuotas=int, date not past |
| DI #8: Audit Logging | Automatic via models.ts | Transactions log every message + update |
| DI #9: Error Recovery | Fail fast + bubble up | Client retries on 503 TemporaryError |

---

## 12. ENVIRONMENT VARIABLES

**No new vars required.** Uses existing:

```
ANTHROPIC_API_KEY              # Claude auth
CLAUDE_MODEL                   # Model to use (default: claude-3-5-sonnet-20241022)
CLAUDE_MAX_CONTEXT_TURNS       # History limit (default: 10)
CLAUDE_TEMPERATURE             # Response determinism (default: 0.3)
GOOGLE_SHEETS_SPREADSHEET_ID   # Sheets to sync
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64  # Sheets auth
SAAS_WEBHOOK_SECRET            # Webhook signature validation
DATABASE_PATH                  # SQLite location (default: ./data/rdd.db)
ENABLE_AUDIT_LOGGING           # Log all changes (default: true)
```

---

## 13. FILES TO CREATE/MODIFY

**Create:**
- `src/agent/claude-agent.ts`
- `src/agent/message-parser.ts`
- `src/agent/agent-db.ts`
- `src/api/agent.ts`
- `src/types/agent.ts`
- `src/agent/claude-agent.test.ts`
- `src/api/agent.test.ts`
- `src/agent/message-parser.test.ts`

**Modify:**
- `src/index.ts` — Register POST /agent/chat
- `src/api/webhook.ts` — Add createConversation() after Sheets append
- `src/sheets/client.ts` — Add updateRegistroRow() method

---

## 14. SUCCESS CRITERIA

- [ ] `npm run build` — zero TypeScript errors
- [ ] `npm run test` — all agent tests pass (30+ tests)
- [ ] `npm run lint` — no linting errors
- [ ] POST /agent/chat accepts valid request and returns AgentResponse
- [ ] POST /agent/chat rejects invalid input with 400
- [ ] Message history loaded and passed to Claude
- [ ] Intent detection correct for acuerdo/pago/cierre/consulta
- [ ] Financial data extraction works for all formats
- [ ] Audit logs record all messages and updates
- [ ] Sheets sync data returned when agreement/payment detected

---

**This spec is complete and ready for parallel IMPL agents to implement each module independently.**
