# RDD SQLite Schema Specification

**Version:** 1.0  
**Phase:** 3 (Agent + Database)  
**Target:** Conversation persistence for Claude multi-turn integration  
**Database:** SQLite3 (file-based, no server overhead)  

---

## Overview

This document specifies the complete SQLite schema for RDD Phase 3. Developers will use this to:
1. Create the database with exact SQL DDL
2. Implement TypeScript models matching table structures
3. Build CRUD operations for conversation management
4. Audit all conversation state changes

The schema supports:
- **Multi-turn conversations** — Full chat history per case (causa_id)
- **Conversation isolation** — Each case has separate conversation thread
- **Audit trail** — All writes logged with user/timestamp/change details
- **Metadata flexibility** — JSON fields for case state, parsed data, flags
- **Atomic transactions** — Message + audit log written together

---

## Table 1: conversations

Stores one conversation thread per case (causa_id). Created when webhook arrives, updated when case closes or transitions.

### SQL DDL

```sql
CREATE TABLE conversations (
  -- Primary Key
  id TEXT PRIMARY KEY NOT NULL,
  
  -- Case Reference
  causa_id TEXT UNIQUE NOT NULL,
  
  -- Metadata
  metadata JSON NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP,
  
  -- Constraints
  CHECK(
    typeof(id) = 'text' AND length(id) > 0 AND
    typeof(causa_id) = 'text' AND length(causa_id) > 0
  )
);

CREATE INDEX idx_conversations_causa_id ON conversations(causa_id);
CREATE INDEX idx_conversations_created_at ON conversations(created_at);
CREATE INDEX idx_conversations_closed_at ON conversations(closed_at);
```

### Column Definitions

| Column | Type | Constraints | Purpose |
|--------|------|-----------|---------|
| `id` | TEXT | PK, NOT NULL, UUID v4 | Unique conversation identifier (e.g., "conv_550e8400e29b41d4a716446655440000") |
| `causa_id` | TEXT | UNIQUE NOT NULL | Reference to legal case from webhook (e.g., "2024-00123") |
| `metadata` | JSON | NOT NULL, default `{}` | Case metadata (see Metadata Schema section) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Conversation created (from webhook) |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | Last modification |
| `closed_at` | TIMESTAMP | nullable | When case was closed (CIERRE webhook received) |

### Design Decisions

- **UUID for id:** Prevents guessing conversation IDs; random, unguessable
- **causa_id UNIQUE:** One conversation per case; simplifies lookups
- **metadata JSON:** Stores case info from webhook (demandado, montos, etapa, tribunal, RIT)
- **closed_at nullable:** Case may never close; allows filtering active vs closed
- **Indexes:** Fast lookup by causa_id (common query), created_at (pagination), closed_at (filtering)

---

## Table 2: messages

Stores all messages in each conversation. One row per turn (user OR assistant). Immutable after creation.

### SQL DDL

```sql
CREATE TABLE messages (
  -- Primary Key
  id TEXT PRIMARY KEY NOT NULL,
  
  -- Foreign Key
  conversation_id TEXT NOT NULL,
  
  -- Message Content
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSON NOT NULL DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CHECK(
    typeof(role) = 'text' AND role IN ('user', 'assistant') AND
    typeof(content) = 'text' AND length(content) > 0 AND
    typeof(id) = 'text' AND length(id) > 0
  )
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_role ON messages(role);
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
```

### Column Definitions

| Column | Type | Constraints | Purpose |
|--------|------|-----------|---------|
| `id` | TEXT | PK, NOT NULL, UUID v4 | Message identifier |
| `conversation_id` | TEXT | FK NOT NULL | Which conversation this belongs to |
| `role` | TEXT | NOT NULL, CHECK IN ('user', 'assistant') | Sender: 'user' or 'assistant' |
| `content` | TEXT | NOT NULL, length > 0 | Message text (user input or Claude response) |
| `metadata` | JSON | NOT NULL, default `{}` | Parsed intent, extracted data (see Metadata Schema) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When message was created |

### Design Decisions

- **One row per message:** Easy to load full history; works with Claude SDK messages array
- **role enum (CHECK constraint):** Ensure only 'user' or 'assistant'; prevents garbage data
- **metadata JSON:** Stores parsed intent (e.g., `{intent: "acuerdo", monto: 500000, cuotas: 5}`)
- **content immutable:** No UPDATE; prevents audit confusion
- **ON DELETE CASCADE:** If conversation deleted, messages deleted too
- **Composite index (conversation_id, created_at):** Fast history load in chronological order

---

## Table 3: audit_log

Dual-layer audit: logs every write operation + all state changes. Append-only, never deleted.

### SQL DDL

```sql
CREATE TABLE audit_log (
  -- Primary Key
  id TEXT PRIMARY KEY NOT NULL,
  
  -- What Changed
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  
  -- Who Changed It
  user_id TEXT NOT NULL,
  
  -- Details
  changes JSON NOT NULL,
  metadata JSON NOT NULL DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  CHECK(
    typeof(entity_type) = 'text' AND entity_type IN ('conversation', 'message') AND
    typeof(action) = 'text' AND action IN ('CREATE', 'UPDATE', 'CLOSE') AND
    typeof(user_id) = 'text' AND length(user_id) > 0 AND
    typeof(id) = 'text' AND length(id) > 0
  )
);

CREATE INDEX idx_audit_log_entity_id ON audit_log(entity_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX idx_audit_log_entity_type_created ON audit_log(entity_type, created_at);
CREATE INDEX idx_audit_log_user_id ON audit_log(user_id);
```

### Column Definitions

| Column | Type | Constraints | Purpose |
|--------|------|-----------|---------|
| `id` | TEXT | PK, NOT NULL, UUID v4 | Audit entry ID |
| `entity_type` | TEXT | NOT NULL, CHECK IN ('conversation', 'message') | What was modified (conversation or message) |
| `entity_id` | TEXT | NOT NULL | ID of entity that changed |
| `action` | TEXT | NOT NULL, CHECK IN ('CREATE', 'UPDATE', 'CLOSE') | Operation: CREATE (new), UPDATE (changed), CLOSE (case ended) |
| `user_id` | TEXT | NOT NULL | Who made the change (e.g., "admin_12345", "webhook_sistema") |
| `changes` | JSON | NOT NULL | What changed: before/after values (see Metadata Schema) |
| `metadata` | JSON | NOT NULL, default `{}` | Context: IP, user agent, trigger (webhook or manual) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT CURRENT_TIMESTAMP | When change happened |

### Design Decisions

- **Append-only:** Never update, never delete; audit trail immutable
- **Dual-layer audit:** Row 1 = change itself; Row 2 = who/when/why audit log
- **entity_type enum:** Only 'conversation' or 'message' (scalable to add more)
- **action enum:** CREATE = new record, UPDATE = field change, CLOSE = case completion
- **user_id:** Either "admin_<id>" (human) or "webhook_sistema" (automated)
- **changes JSON:** Stores `{field: {before: ..., after: ...}}` for every modification
- **Indexes:** Fast query by entity (what changed), action (what type of change), user (who did it), date (when)

---

## TypeScript Type Definitions

### Enums

```typescript
/**
 * MessageRole - Who sent the message
 * - 'user': User input (admin/staff from chat)
 * - 'assistant': Claude response (RDD agent)
 */
export type MessageRole = 'user' | 'assistant';

/**
 * AuditAction - What operation occurred
 * - 'CREATE': New record inserted
 * - 'UPDATE': Existing record modified
 * - 'CLOSE': Case closure
 */
export type AuditAction = 'CREATE' | 'UPDATE' | 'CLOSE';

/**
 * AuditEntityType - What entity changed
 * - 'conversation': Conversation table modified
 * - 'message': Message table modified
 */
export type AuditEntityType = 'conversation' | 'message';
```

### Conversation Type

```typescript
/**
 * Conversation - One thread per case
 * Represents a complete conversation history for a legal case (causa_id).
 * Created when webhook arrives, closed when case finalizes.
 */
export interface Conversation {
  /** Unique conversation ID (UUID v4) */
  id: string;
  
  /** Case reference (e.g., "2024-00123", from webhook) */
  causa_id: string;
  
  /** Case metadata from webhook + runtime state */
  metadata: ConversationMetadata;
  
  /** When conversation started (webhook received) */
  created_at: Date;
  
  /** Last time conversation was modified */
  updated_at: Date;
  
  /** When case was closed (null if still active) */
  closed_at: Date | null;
}

/**
 * ConversationMetadata - JSON shape for conversations.metadata
 * Stores case info from webhook + runtime parsed state
 */
export interface ConversationMetadata {
  /** From webhook: demandado name */
  demandado?: string;
  
  /** From webhook: plaintiff amount (monto demanda) */
  monto_demanda?: number;
  
  /** From webhook: initial tribunal */
  tribunal?: string;
  
  /** From webhook: RIT number */
  rit?: string;
  
  /** From webhook: case stage (litigacion, cobranza, etc.) */
  etapa?: string;
  
  /** Parsed in conversation: registered settlement amount */
  acuerdo_monto?: number;
  
  /** Parsed in conversation: payment installments */
  acuerdo_cuotas?: number;
  
  /** Parsed in conversation: lawyer handling closure */
  abogado_nombre?: string;
  
  /** Parsed in conversation: lawyer email */
  abogado_email?: string;
  
  /** System: case stage (litigacion | cobranza | archivado) */
  case_state?: 'litigacion' | 'cobranza' | 'archivado';
  
  /** System: how many messages in this conversation */
  message_count?: number;
}
```

### Message Type

```typescript
/**
 * Message - One turn of conversation
 * Immutable after creation. Sent by user or Claude assistant.
 */
export interface Message {
  /** Unique message ID (UUID v4) */
  id: string;
  
  /** Which conversation this belongs to */
  conversation_id: string;
  
  /** Who sent: 'user' or 'assistant' */
  role: MessageRole;
  
  /** Message text (user input or Claude response) */
  content: string;
  
  /** Parsed intent + extracted data */
  metadata: MessageMetadata;
  
  /** When message was created */
  created_at: Date;
}

/**
 * MessageMetadata - JSON shape for messages.metadata
 * User messages: parsed intent + extracted values
 * Assistant messages: response strategy, confidence, flags
 */
export interface MessageMetadata {
  /** For user messages: detected intent */
  intent?: 'acuerdo' | 'pago' | 'cierre' | 'consulta' | 'otro';
  
  /** For user messages: extracted monto (in pesos) */
  monto_extraido?: number;
  
  /** For user messages: extracted cuotas count */
  cuotas_extraido?: number;
  
  /** For user messages: extracted fecha */
  fecha_extraida?: string;
  
  /** For assistant messages: response type */
  response_type?: 'confirmation' | 'ask_for_clarification' | 'error' | 'summary';
  
  /** For assistant messages: processing success */
  processing_ok?: boolean;
  
  /** For assistant messages: any warnings/flags */
  flags?: string[];
  
  /** System: which Claude model generated response (if assistant) */
  model?: string;
  
  /** System: token usage (if assistant) */
  tokens_used?: {
    input: number;
    output: number;
  };
}
```

### AuditLogEntry Type

```typescript
/**
 * AuditLogEntry - Immutable audit trail record
 * Every write to conversations/messages logged here.
 * Append-only, never updated or deleted.
 */
export interface AuditLogEntry {
  /** Unique audit entry ID (UUID v4) */
  id: string;
  
  /** What entity type changed */
  entity_type: AuditEntityType;
  
  /** Which entity was modified */
  entity_id: string;
  
  /** What happened (CREATE, UPDATE, CLOSE) */
  action: AuditAction;
  
  /** Who triggered the change */
  user_id: string;
  
  /** What fields changed (before/after values) */
  changes: AuditChanges;
  
  /** Additional context */
  metadata: AuditMetadata;
  
  /** When change occurred */
  created_at: Date;
}

/**
 * AuditChanges - Stores before/after values
 * For each field that changed, record old and new value
 */
export type AuditChanges = Record<string, {
  before: unknown;
  after: unknown;
}>;

/**
 * AuditMetadata - Context for why change happened
 */
export interface AuditMetadata {
  /** How change was triggered: 'webhook', 'manual_user', 'system' */
  trigger?: 'webhook' | 'manual_user' | 'system';
  
  /** If webhook, which webhook type */
  webhook_type?: 'CREACION' | 'CIERRE' | 'ACTUALIZACION';
  
  /** IP address of requester (if manual) */
  ip_address?: string;
  
  /** User agent (if manual) */
  user_agent?: string;
  
  /** Notes about change */
  notes?: string;
}
```

---

## Index Definitions & Query Patterns

### Index 1: conversation.causa_id

```sql
CREATE INDEX idx_conversations_causa_id ON conversations(causa_id);
```

**Query Pattern:** Load conversation by case ID
```typescript
const conv = await db.get(
  'SELECT * FROM conversations WHERE causa_id = ?',
  [causaId]
);
```

**Why:** Webhook arrives with causa_id; need to find/create conversation fast.

---

### Index 2: messages.conversation_id (with created_at)

```sql
CREATE INDEX idx_messages_conversation_created ON messages(conversation_id, created_at);
```

**Query Pattern:** Load full conversation history chronologically
```typescript
const messages = await db.all(
  'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
  [conversationId]
);
```

**Why:** Claude SDK needs all messages in order; composite index avoids full table scan.

---

### Index 3: audit_log.entity_id

```sql
CREATE INDEX idx_audit_log_entity_id ON audit_log(entity_id);
```

**Query Pattern:** Query audit trail for specific conversation/message
```typescript
const audits = await db.all(
  'SELECT * FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC',
  [entityId]
);
```

**Why:** Compliance: show all changes to a conversation.

---

### Index 4: audit_log.created_at

```sql
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at);
```

**Query Pattern:** Recent changes (for monitoring/alerts)
```typescript
const recent = await db.all(
  'SELECT * FROM audit_log WHERE created_at > ? ORDER BY created_at DESC',
  [tenMinutesAgo]
);
```

**Why:** Dashboard, real-time alerts, compliance monitoring.

---

### Index 5: conversations.closed_at

```sql
CREATE INDEX idx_conversations_closed_at ON conversations(closed_at);
```

**Query Pattern:** Find active (not closed) conversations
```typescript
const active = await db.all(
  'SELECT * FROM conversations WHERE closed_at IS NULL'
);
```

**Why:** List only active cases for admin dashboard.

---

## CRUD Operation Signatures

### Conversation CRUD

#### Create Conversation

```typescript
/**
 * Create new conversation from webhook
 * @param causaId - Case ID from webhook
 * @param webhookData - Webhook payload (demandado, montos, etc.)
 * @returns Created conversation
 */
async function createConversation(
  causaId: string,
  webhookData: WebhookPayload
): Promise<Conversation> {
  // Generates: id (UUID), created_at, updated_at
  // Stores: causa_id, metadata (from webhook)
  // Transactional: conversation + audit log
}
```

#### Load Conversation

```typescript
/**
 * Load conversation by causa_id
 * @param causaId - Case ID
 * @returns Conversation or null if not found
 */
async function getConversationByCausaId(
  causaId: string
): Promise<Conversation | null> {
  // Uses: idx_conversations_causa_id
}
```

#### Update Conversation Metadata

```typescript
/**
 * Update conversation metadata (e.g., add parsed acuerdo)
 * @param conversationId - Conversation ID
 * @param updates - Partial metadata to merge
 * @returns Updated conversation
 */
async function updateConversationMetadata(
  conversationId: string,
  updates: Partial<ConversationMetadata>
): Promise<Conversation> {
  // Merges updates into metadata JSON
  // Transactional: conversation + audit log
  // Updates: updated_at timestamp
}
```

#### Close Conversation

```typescript
/**
 * Close conversation (case finalized)
 * @param conversationId - Conversation ID
 * @param userId - Who closed it
 * @returns Updated conversation
 */
async function closeConversation(
  conversationId: string,
  userId: string
): Promise<Conversation> {
  // Sets: closed_at = NOW()
  // Creates: audit log entry (action: 'CLOSE')
  // Transactional: both tables
}
```

### Message CRUD

#### Create Message

```typescript
/**
 * Add message to conversation
 * @param conversationId - Which conversation
 * @param role - 'user' or 'assistant'
 * @param content - Message text
 * @param metadata - Parsed intent or response strategy
 * @returns Created message
 */
async function createMessage(
  conversationId: string,
  role: MessageRole,
  content: string,
  metadata?: MessageMetadata
): Promise<Message> {
  // Generates: id (UUID), created_at
  // Stores: all fields
  // Transactional: message + audit log
}
```

#### Load Conversation History

```typescript
/**
 * Load full conversation for Claude SDK
 * @param conversationId - Which conversation
 * @returns All messages in order (user, assistant, user, ...)
 */
async function getConversationHistory(
  conversationId: string
): Promise<Message[]> {
  // Uses: idx_messages_conversation_created
  // Returns: chronological order
}
```

#### Get Latest N Messages

```typescript
/**
 * Get most recent N messages (for context window limits)
 * @param conversationId - Which conversation
 * @param limit - How many messages (e.g., 20)
 * @returns Last N messages in order
 */
async function getRecentMessages(
  conversationId: string,
  limit: number = 20
): Promise<Message[]> {
  // SELECT * FROM messages WHERE conversation_id = ?
  // ORDER BY created_at DESC LIMIT ?
  // Then reverse to get chronological order
}
```

### Audit Log (Append Only)

#### Create Audit Entry

```typescript
/**
 * Log a change (internal, called by transaction)
 * @param entityType - 'conversation' or 'message'
 * @param entityId - Which entity changed
 * @param action - 'CREATE', 'UPDATE', or 'CLOSE'
 * @param userId - Who made change
 * @param changes - Before/after values
 * @param metadata - Trigger, IP, notes
 * @returns Created audit entry
 */
async function createAuditLogEntry(
  entityType: AuditEntityType,
  entityId: string,
  action: AuditAction,
  userId: string,
  changes: AuditChanges,
  metadata?: AuditMetadata
): Promise<AuditLogEntry> {
  // Generates: id (UUID), created_at
  // Inserts: all fields
  // No transaction needed (immutable append)
}
```

#### Query Audit Trail

```typescript
/**
 * Get all changes to an entity
 * @param entityId - Conversation or message ID
 * @returns All audit entries for that entity, newest first
 */
async function getAuditTrail(
  entityId: string
): Promise<AuditLogEntry[]> {
  // Uses: idx_audit_log_entity_id
}
```

---

## JSON Metadata Schema

### ConversationMetadata Example

```json
{
  "demandado": "Juan García López",
  "monto_demanda": 2500000,
  "tribunal": "Juzgado de Letras del Trabajo #5, Santiago",
  "rit": "2024-00123-0",
  "etapa": "litigacion",
  "acuerdo_monto": 1800000,
  "acuerdo_cuotas": 5,
  "abogado_nombre": "María Consuelo Vega",
  "abogado_email": "mvega@bufete.cl",
  "case_state": "cobranza",
  "message_count": 12
}
```

### MessageMetadata Example (User Message)

```json
{
  "intent": "acuerdo",
  "monto_extraido": 1800000,
  "cuotas_extraido": 5,
  "fecha_extraida": "2026-06-15"
}
```

### MessageMetadata Example (Assistant Message)

```json
{
  "response_type": "confirmation",
  "processing_ok": true,
  "flags": ["monto_verifica_range"],
  "model": "claude-3-5-sonnet-20241022",
  "tokens_used": {
    "input": 1245,
    "output": 287
  }
}
```

### AuditChanges Example

```json
{
  "metadata.acuerdo_monto": {
    "before": null,
    "after": 1800000
  },
  "metadata.acuerdo_cuotas": {
    "before": null,
    "after": 5
  },
  "updated_at": {
    "before": "2026-05-30T10:00:00Z",
    "after": "2026-05-30T10:05:30Z"
  }
}
```

### AuditMetadata Example

```json
{
  "trigger": "webhook",
  "webhook_type": "CREACION",
  "notes": "New case from SaaS webhook"
}
```

---

## Database Initialization Flow

### Auto-Create Schema on Startup

```typescript
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

/**
 * Initialize database: create all tables if missing
 * Called on app startup (src/index.ts)
 */
export async function initializeDatabase(dbPath: string): Promise<Database.Database> {
  let db: Database.Database;
  
  try {
    // 1. Open or create file
    db = new Database(dbPath);
    logger.info({ dbPath }, 'Database file opened/created');
    
    // 2. Enable foreign keys (required for CASCADE deletes)
    db.pragma('foreign_keys = ON');
    
    // 3. Create tables (idempotent: IF NOT EXISTS)
    const schema = `
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY NOT NULL,
        causa_id TEXT UNIQUE NOT NULL,
        metadata JSON NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TIMESTAMP,
        CHECK(
          typeof(id) = 'text' AND length(id) > 0 AND
          typeof(causa_id) = 'text' AND length(causa_id) > 0
        )
      );
      
      CREATE INDEX IF NOT EXISTS idx_conversations_causa_id 
        ON conversations(causa_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_created_at 
        ON conversations(created_at);
      CREATE INDEX IF NOT EXISTS idx_conversations_closed_at 
        ON conversations(closed_at);
      
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY NOT NULL,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSON NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        CHECK(
          typeof(role) = 'text' AND role IN ('user', 'assistant') AND
          typeof(content) = 'text' AND length(content) > 0 AND
          typeof(id) = 'text' AND length(id) > 0
        )
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_id 
        ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at 
        ON messages(created_at);
      CREATE INDEX IF NOT EXISTS idx_messages_role 
        ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created 
        ON messages(conversation_id, created_at);
      
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT NOT NULL,
        changes JSON NOT NULL,
        metadata JSON NOT NULL DEFAULT '{}',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(
          typeof(entity_type) = 'text' AND 
            entity_type IN ('conversation', 'message') AND
          typeof(action) = 'text' AND 
            action IN ('CREATE', 'UPDATE', 'CLOSE') AND
          typeof(user_id) = 'text' AND length(user_id) > 0 AND
          typeof(id) = 'text' AND length(id) > 0
        )
      );
      
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id 
        ON audit_log(entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_action 
        ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created_at 
        ON audit_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_created 
        ON audit_log(entity_type, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_log_user_id 
        ON audit_log(user_id);
    `;
    
    db.exec(schema);
    logger.info('All tables created (or already exist)');
    
  } catch (error) {
    if (error instanceof Error) {
      logger.error(
        { error: error.message, dbPath },
        'Database initialization failed'
      );
    }
    throw error;
  }
  
  return db;
}
```

### Environment Variables

```bash
# .env
DATABASE_PATH=./data/rdd.db          # Where SQLite file lives
NODE_ENV=production                   # For logging level
```

### Error Handling

| Error | Cause | Handling |
|-------|-------|----------|
| **ENOENT** | Directory doesn't exist | Create `/data` directory before startup |
| **EACCES** | No write permission | Ensure app user owns `/data` directory |
| **CORRUPT** | DB file is corrupted | Restore from backup, log incident, alert admin |
| **LOCKED** | DB locked (concurrent access) | Retry with exponential backoff (better-sqlite3 handles this) |
| **CONSTRAINT** | Duplicate causa_id or invalid enum | Reject change, return 400 Bad Request |

---

## Query Examples

### 1. Load Full Conversation History (for Claude SDK)

```typescript
/**
 * Load conversation context for multi-turn Claude call
 * Used in: src/agent/claude-api.ts
 */
async function loadConversationContext(causaId: string) {
  // 1. Find conversation
  const conversation = await db.get(
    'SELECT * FROM conversations WHERE causa_id = ?',
    [causaId]
  );
  
  if (!conversation) {
    throw new Error(`Conversation not found for causa_id: ${causaId}`);
  }
  
  // 2. Load all messages in chronological order
  const messages = await db.all(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversation.id]
  );
  
  // 3. Format for Claude SDK
  const systemPrompt = `
    Eres RDD, asistente para registro de ingresos de causas legales.
    Demandado: ${conversation.metadata.demandado}
    Monto demanda: $${conversation.metadata.monto_demanda}
    Etapa: ${conversation.metadata.etapa}
  `;
  
  const messagesForClaude = messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
  
  return { systemPrompt, messages: messagesForClaude, conversation };
}
```

### 2. Write Message + Audit Log Atomically

```typescript
/**
 * Add user message + log audit entry in single transaction
 * Used in: POST /agent/chat endpoint
 */
async function addMessageWithAudit(
  conversationId: string,
  userMessage: string,
  userId: string
): Promise<Message> {
  return db.transaction(() => {
    // 1. Insert message
    const messageId = generateUUID();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      messageId,
      conversationId,
      'user',
      userMessage,
      JSON.stringify({})
    );
    
    // 2. Create audit log entry
    db.prepare(`
      INSERT INTO audit_log (id, entity_type, entity_id, action, user_id, changes, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      generateUUID(),
      'message',
      messageId,
      'CREATE',
      userId,
      JSON.stringify({
        id: { before: null, after: messageId },
        content: { before: null, after: userMessage }
      }),
      JSON.stringify({ trigger: 'manual_user' })
    );
    
    // 3. Return created message
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  })();
}
```

### 3. Query Audit Trail by Causa_ID

```typescript
/**
 * Get complete audit trail for a case
 * Used in: Admin compliance view
 */
async function getAuditTrailForCase(causaId: string): Promise<AuditLogEntry[]> {
  // 1. Find conversation
  const conversation = db.prepare(
    'SELECT id FROM conversations WHERE causa_id = ?'
  ).get(causaId);
  
  if (!conversation) {
    return [];
  }
  
  // 2. Get all changes to this conversation
  const conversationAudits = db.prepare(`
    SELECT * FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC
  `).all(conversation.id);
  
  // 3. Get all changes to messages in this conversation
  const messageIds = db.prepare(`
    SELECT id FROM messages WHERE conversation_id = ?
  `).all(conversation.id);
  
  const messageAudits = [];
  for (const msg of messageIds) {
    const audits = db.prepare(`
      SELECT * FROM audit_log WHERE entity_id = ? ORDER BY created_at DESC
    `).all(msg.id);
    messageAudits.push(...audits);
  }
  
  // 4. Combine and sort by timestamp
  return [...conversationAudits, ...messageAudits].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}
```

### 4. Get Latest N Messages of Conversation

```typescript
/**
 * Load recent messages for context window optimization
 * Used in: src/agent/context-window.ts
 */
async function getRecentConversationMessages(
  conversationId: string,
  limit: number = 20
): Promise<Message[]> {
  const messages = db.prepare(`
    SELECT * FROM messages 
    WHERE conversation_id = ? 
    ORDER BY created_at DESC 
    LIMIT ?
  `).all(conversationId, limit);
  
  // Reverse to get chronological order (oldest first)
  return messages.reverse();
}
```

---

## Summary

This schema provides:

✅ **Conversation isolation** — One thread per case (causa_id UNIQUE)  
✅ **Full history** — Every message stored and retrievable  
✅ **Atomic writes** — Message + audit logged together  
✅ **Audit trail** — All changes logged with who/when/what  
✅ **Flexible metadata** — JSON for case state, parsed data, flags  
✅ **Performance** — 5 indexes for common query patterns  
✅ **Type safety** — TypeScript interfaces matching DB schema  
✅ **Constraints** — CHECK for enums, FOREIGN KEY for referential integrity  

**Implementation:** Copy SQL blocks directly into `src/database/client.ts` (initialization). Use TypeScript types directly in `src/types/models.ts`. Build models.ts with these CRUD functions.

**Next Phase:** Phase 3b (Agent Implementation) will use these types and CRUD operations to build the multi-turn conversation handler.
