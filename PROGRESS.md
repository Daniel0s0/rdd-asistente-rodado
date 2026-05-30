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

## Quick Links

- [TASKS.md](TASKS.md) — What phases are complete, what's next
- [CLAUDE.md](CLAUDE.md) — Discipline rules and project overview
- [.claude/rules/](.claude/rules/) — Auto-loading rules
