---
paths: ["docs/superpowers/plans/**/*", "PROGRESS.md", "TASKS.md"]
---

# Harness Engineering Rule: Agent Orchestration & State Management

This rule clarifies how to use **Rule 0 (Agent Orchestration)** within the RDD Harness Engineering framework.

---

## Core Principle

**State is the source of truth, not memory.**

The harness framework (init.sh, TASKS.md, PROGRESS.md, rules) keeps state visible so:
- Next session knows what was decided and learned
- Agents know the scope and context without re-investigating
- You can delegate confidently to subagents (they read the same source of truth)

---

## The Harness Layers (Rule 0 Expansion)

When you work on RDD, you operate within 4 concentric layers:

### Layer 1: Framework State (Visible to All Sessions)
- **TASKS.md** — Current phase, what's done, what's next
- **PROGRESS.md** — Decisions made, learnings, blockers
- **CLAUDE.md** — Discipline rules and project patterns
- **.claude/rules/** — Auto-loading behavioral rules

This layer **never changes during a session** (except updates at the end). It's your "read" when starting work.

### Layer 2: Session Agents (Current Session)
- **Main Session** (This Session) — Implementation
- **Explore Agent** — Investigation + research
- **Code Solution Validator** — Review before push

Each agent reads Layer 1 and produces output (findings, code, validation). Output is transient (exists in conversation).

### Layer 3: Session Output (Handoff to Next Session)
- Commit messages (trace to user request)
- Code changes (implement user request)
- Updated PROGRESS.md / TASKS.md (if decisions/blockers emerged)

Layer 3 feeds back into Layer 1 for the next session.

### Layer 4: Auto-Loading Rules
- **behavioral-guidelines.md** — Discipline rules (Rule 0-4, invariants)
- **api-patterns.md** — When editing src/api/**/*.ts
- **agent-patterns.md** — When editing src/agent/**/*.ts
- **sheets-drive-patterns.md** — When editing src/sheets/**/* or src/drive/**/*
- **testing-strategy.md** — When editing tests/**/*.ts

Auto-load based on file patterns. Reinforce discipline as you code.

---

## Agent Orchestration Workflow (Rule 0 + Harness)

### Case 1: Exploratory Work (Don't Know What to Build Yet)

```
1. SESSION START
   └─> ./scripts/init.sh
   └─> Read TASKS.md (understand scope)
   └─> Read PROGRESS.md (understand context)
   └─> Read CLAUDE.md Section 0

2. ANALYZE AMBIGUITY
   └─> "How should Phase 3 conversation context work?"
   └─> "Do we use SQLite or Postgres?"

3. DISPATCH: Explore Agent
   └─> Agent investigates:
       - Existing patterns in codebase
       - Domain requirements from behavioral-guidelines.md
       - Similar systems (how they handle context)
   └─> Produces: Findings doc with options

4. IN THIS SESSION
   └─> Read Explore Agent findings
   └─> Use EnterPlanMode to design approach
   └─> Make decision
   └─> Document decision in PROGRESS.md (D#: SQLite for Phase 3 because...)

5. DOCUMENT & COMMIT
   └─> git add PROGRESS.md
   └─> git commit -m "docs: Phase 3 architecture decision — SQLite for conversations"
```

### Case 2: Implementation Work (Know What to Build)

```
1. SESSION START
   └─> ./scripts/init.sh
   └─> Read TASKS.md (see Phase 3 scope)
   └─> Read PROGRESS.md (see Phase 3 decisions)

2. CLARIFY SCOPE
   └─> EnterPlanMode (design task breakdown)
   └─> Identify files to create/modify
   └─> Plan test strategy

3. IF LARGE SCOPE
   └─> Use superpowers:subagent-driven-development
   └─> Dispatch fresh agent per task
   └─> Each agent:
       - Reads TASKS.md for scope
       - Reads PROGRESS.md for decisions
       - Reads .claude/rules/ for discipline
       - Implements task
       - Commits result

4. IF SMALL SCOPE
   └─> Implement in this session
   └─> Run tests (npm run test)
   └─> Code Solution Validator reviews
   └─> Commit

5. CAPTURE LEARNING
   └─> If hit a problem → Add to PROGRESS.md (L#: Learned X)
   └─> If phase complete → Update TASKS.md (Phase N ✅)
   └─> Commit

6. HANDOFF
   └─> PROGRESS.md + TASKS.md updated
   └─> Code committed
   └─> Next session has full context
```

### Case 3: Bug Fix or Small Refinement

```
1. SESSION START (same as above)

2. FIX
   └─> Fix the issue
   └─> Run tests (npm run test)
   └─> Confirm fix works

3. COMMIT
   └─> Commit with clear message
   └─> DON'T update PROGRESS.md unless decision emerged
   └─> DON'T update TASKS.md unless phase status changed

4. IF LEARNING EMERGED
   └─> Add to PROGRESS.md (L#: Learned why this bug happened)
   └─> Commit PROGRESS.md

5. HANDOFF
   └─> PROGRESS.md (if updated)
   └─> Code committed
```

---

## How Agents Read State

When dispatching agents, they should **read these files in order:**

1. **CLAUDE.md** — Master guide + Quick Start
2. **TASKS.md** — Understand scope for current phase
3. **PROGRESS.md** — Understand decisions that shaped scope
4. **.claude/rules/** — Understand discipline rules
5. **Code** — Understand existing patterns

Agents should **NOT** need to:
- Re-investigate the codebase from scratch
- Re-discuss already-made decisions
- Guess at domain requirements

The framework makes this possible: state is written down.

---

## When to Update Framework Files

### PROGRESS.md — Add After:
- Making a major decision (D#: Title)
- Hitting a bug and learning why (L#: Title)
- Encountering a blocker (B#: Title)
- Completing a phase (summarize learnings)

### TASKS.md — Update After:
- Completing a phase
- Discovering phase scope is different than expected
- Uncovering a blocker that delays next phase
- Planning details for next phase

### CLAUDE.md — Revise When:
- Discipline rules change
- Project workflow changes
- New patterns emerge that become law
- Major architectural decision made

### .claude/rules/* — Update When:
- Pattern becomes standard across codebase
- New edge case discovered that must be documented
- Existing rule proves insufficient

---

## Red Flags in Harness Usage

Stop if you see:

| Red Flag | Problem | Fix |
|----------|---------|-----|
| Agent doesn't know phase scope | Didn't read TASKS.md | Add link to TASKS.md in agent prompt |
| Decision disputed next session | Wasn't documented | Update PROGRESS.md with why |
| Same bug happens twice | Learning wasn't captured | Add to PROGRESS.md (L#: Learned) |
| Agent re-does work | Scope wasn't clear | TASKS.md wasn't detailed enough |
| Phase blocker surprised us | Wasn't anticipated | Add to PROGRESS.md (B#: Blocker) |
| New dev confused about decisions | Decisions lived in commits | Move to PROGRESS.md as D# |

---

## Template: Documenting a Phase

When you complete a phase, update TASKS.md like this:

```markdown
## Phase N: [Name] ✅

**What was built:**
- File 1: [Brief description]
- File 2: [Brief description]

**Key decisions:**
- Decision 1 (see PROGRESS.md D#)
- Decision 2 (see PROGRESS.md D#)

**Tests status:** ✅ X/Y passing

**Commits:**
- HASH: Message

**Learnings captured:**
- See PROGRESS.md L# for details
```

Then in PROGRESS.md, add date section:

```markdown
## [Date] — Phase N Complete

### Decisions Made

**D#: [Title]**
- Chose: [Option]
- Reason: [Why]
- Trade-off: [What you gave up]
- Impact: [How it affects future phases]

### Learnings

**L#: [Title]**
- What you learned
- Why it matters
- How it changes future work

### Blockers

**B#: [If any]**
- What's blocking
- Proposed solution
```

---

## Integration with Rule 0 (Agent Orchestration)

Rule 0 defines the agent roles. This rule extends it with **state management**:

| Agent | Reads | Produces | Updates State? |
|-------|-------|----------|---|
| Explore | TASKS.md, PROGRESS.md, rules, code | Findings doc | No (transient) |
| This Session | Explore findings, PROGRESS.md | Code + commits | Yes (via commits) |
| Validator | Code, tests, PROGRESS.md | Validation report | No (signals for fixes) |
| Next Session | TASKS.md, PROGRESS.md, rules, code | New work | Yes (if decisions emerge) |

---

## Quick Checklist: Did You Use Harness Correctly?

- [ ] Started session with `./scripts/init.sh`
- [ ] Read TASKS.md to understand phase scope
- [ ] Read PROGRESS.md to understand past decisions
- [ ] If large scope: used subagent-driven-development
- [ ] If made a decision: documented it in PROGRESS.md
- [ ] If hit a learning: added to PROGRESS.md
- [ ] If hit a blocker: documented in PROGRESS.md or TASKS.md
- [ ] If phase complete: updated TASKS.md status
- [ ] Each commit message traces to user request
- [ ] Tests pass before committing

---

## See Also

- [behavioral-guidelines.md](behavioral-guidelines.md) — Rule 0 (Agent Orchestration) in detail
- [CLAUDE.md](../../CLAUDE.md) — Master guide
- [TASKS.md](../../TASKS.md) — Current phase roadmap
- [PROGRESS.md](../../PROGRESS.md) — Decision and learning log
