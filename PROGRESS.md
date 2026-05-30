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

## Example: Phase 3 Planning

When Phase 3 starts, add a new date section:

```markdown
## May 30, 2026 — Phase 3 Planning

### Decisions Made

**D6: SQLite for conversation store**
- Chose: SQLite (lightweight, file-based, no server)
- Reason: RDD is simple, don't need Postgres complexity yet
- Trade-off: Harder to scale horizontally later
- Impact: Conversation schema will be simple 2-3 table design

**D7: Conversation context loaded at start, not streamed**
- Chose: Load full history when user starts chatting
- Reason: Claude multi-turn works better with full context
- Trade-off: Memory usage grows with conversation length
- Impact: May need pagination/archiving for old conversations

### Learnings

**L6: Claude API expects conversation array format**
- Learned: Messages must be [{ role, content }], not plain text
- Future: Check Claude SDK docs before implementing agent parsing

### Blockers

**B1: How do we trigger RDD from webhook?**
- Problem: Webhook creates row in Sheets, but how does RDD know to start chatting?
- Option A: Polling (RDD checks Sheets every N seconds)
- Option B: Webhook calls RDD directly (creates conversation)
- Option C: Admin UI triggers RDD manually
- Next: Clarify with team what makes sense
```

---

## Quick Links

- [TASKS.md](TASKS.md) — What phases are complete, what's next
- [CLAUDE.md](CLAUDE.md) — Discipline rules and project overview
- [.claude/rules/](.claude/rules/) — Auto-loading rules
