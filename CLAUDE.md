# CLAUDE.md - RDD: Asistente Rodado

Guía maestra para trabajar en RDD. **Disciplina:** Agent Orchestration + 4 Reglas inalterable + Domain Invariants + stack claro.

---

## 📊 Estado Actual

**Fase:** 1 (Infraestructura Base) ✅ → Fase 2 (Webhook Listener) ✅ → Próximo: [Fase 3 (Agent + DB)](TASKS.md)  
**Completado:** src/config/, src/utils/, src/api/health, src/api/webhook, src/sheets/client, deployment/  
**En construcción:** src/agent/, src/database/, src/drive/ (según [TASKS.md](TASKS.md))

**Harness Engineering Status:**
- ✅ Health check script: `./scripts/init.sh`
- ✅ Task roadmap: [TASKS.md](TASKS.md)
- ✅ Progress log: [PROGRESS.md](PROGRESS.md)
- ✅ Auto-loading rules: `.claude/rules/`
- ✅ Agent Orchestration: [behavioral-guidelines.md](.claude/rules/behavioral-guidelines.md) (Rule 0)

---

## ⚡ Disciplina: Regla 0 + 4 Reglas (Consulta behavioral-guidelines.md para detalles)

**Regla 0: Agent Orchestration**  
Mantén contexto limpio. Flujo: **Explore Agent** (investigación) → **This Session** (implementación) → **Validator Agent** (revisión) → **Push**. No polutes main session con logs enormes.

**Reglas 1-4:**
1. **Think Before Coding** — Usa `EnterPlanMode` para CADA cambio
2. **Simplicity First** — Solo código pedido, sin especulaciones
3. **Surgical Changes** — Toca SOLO lo necesario
4. **Goal-Driven Execution** — Define "done" antes de codificar

---

## Stack

**Backend:** Node.js 18+ | TypeScript 5 (strict)  
**Framework:** Express.js (API ligero)  
**AI:** Claude SDK (Anthropic)  
**APIs Externas:** Google Sheets | Google Drive  
**Testing:** Vitest  
**Deployment:** PM2 (VPS)

---

## 🚀 Quick Start

```bash
# Setup inicial
cp .env.example .env
npm install
npm run dev                # Puerto 3001 (local)

# Testing + Deploy
npm run test               # OBLIGATORIO antes de push
npm run build
```

---

## 🛠️ Harness Engineering Framework

The RDD project uses a disciplined workflow to keep state visible and decisions documented. This section explains how to use the framework.

### Session Entry Point

**Every session starts here:**

```bash
# 1. Health check (confirms setup is working)
./scripts/init.sh

# 2. Review current state
cat TASKS.md              # See what phases are complete, what's next
cat PROGRESS.md           # See what decisions were made, what we learned
cat CLAUDE.md             # Understand rules and patterns

# 3. Start work
npm run dev              # Local server (3001)
```

### The Four Framework Components

| Component | Purpose | When to Use |
|-----------|---------|------------|
| **scripts/init.sh** | Health check for Node, .env, dependencies, tests | At every session start |
| **TASKS.md** | Current phase status + roadmap for all 5 phases | Before starting work to see scope |
| **PROGRESS.md** | Decisions made + learnings captured | Before Phase 3+ to understand context |
| **behavioral-guidelines.md** (Rule 0) | How to orchestrate agents | When delegating work or planning |

### How Work Flows Through The Harness

```
1. SESSION START
   └─> ./scripts/init.sh (verify health)
   └─> Review TASKS.md (see phase status)
   └─> Review PROGRESS.md (see past decisions)

2. CLARIFY SCOPE
   └─> Read CLAUDE.md Section 0 (Agent Orchestration)
   └─> If exploratory work → Dispatch Explore Agent
   └─> If implementation → Plan with EnterPlanMode

3. WORK
   └─> This Session: Implement using findings
   └─> Code Solution Validator: Review before push
   └─> Commit with clear message

4. DOCUMENT
   └─> If made a decision → Add to PROGRESS.md
   └─> If phase complete → Update TASKS.md status
   └─> Commit changes

5. HANDOFF (If using agents)
   └─> Explore Agent output → documented in session
   └─> Implementation plan → saved to docs/superpowers/plans/
   └─> Validation → Code Solution Validator
   └─> Next session → can see all context
```

### When to Update Framework Files

**Update TASKS.md:**
- When you complete a phase
- When you discover phase scope is larger than expected
- When blockers emerge that delay next phase

**Update PROGRESS.md:**
- After every significant decision
- After you hit a problem and learn something
- After completing a phase (summarize learnings)

**Run init.sh:**
- At the start of every work session
- If you've pulled new changes
- If you change .env or dependencies

---

## Core Commands

| Comando | Propósito |
|---------|-----------|
| `npm run dev` | Servidor local (puerto 3001) |
| `npm run test` | Todos los tests (OBLIGATORIO) |
| `npm run test:watch` | Tests en modo watch |
| `npm run test:coverage` | Cobertura de tests |
| `npm run build` | Compilar TypeScript → dist/ |
| `npm run type-check` | Validar tipos sin compilar |
| `npm run lint -- --fix` | Lint + format automático |
| `npm run format` | Prettier (formateo solamente) |

---

## Project Structure

**Estado actual:** Fase 1 ✅ + Fase 2 ✅  
**Estructura completa** (se construye en fases según GUIA_IMPLEMENTACION.md):

```
src/
├─ api/
│  ├─ health.ts     → GET /health — Fase 1 ✅
│  └─ webhook.ts    → POST /webhook/causa-nueva — Fase 2 ✅
├─ sheets/
│  └─ client.ts     → Google Sheets append (REGISTRO tab) — Fase 2 ✅
├─ agent/          → Claude logic + multi-turn parsing — Fase 3 (próximo)
├─ database/       → Conversation store (SQLite) — Fase 3 (próximo)
├─ drive/          → Google Drive API wrapper — Fase 5
├─ types/          → RDD domain types ✅
├─ utils/          → Logger, validators ✅
├─ config/         → Env validation, constants ✅
└─ index.ts        → Express entry point ✅

tests/
├─ unit/           → config, webhook, agent (próximo)
└─ integration/    → health, webhook, E2E (próximo)

.claude/rules/     → Auto-loading discipline rules ✅
docs/              → Architecture, API, setup guides
deployment/        → PM2 config ✅
```

---

## Auto-Loading Rules

Cuando editas un archivo `.ts`, las reglas auto-cargan por patrón:

| Regla | Aplica a |
|-------|----------|
| **behavioral-guidelines.md** | `src/**/*`, `tests/**/*` |
| **api-patterns.md** | `src/api/**/*` |
| **agent-patterns.md** | `src/agent/**/*` |
| **sheets-drive-patterns.md** | `src/sheets/**/*`, `src/drive/**/*` |
| **testing-strategy.md** | `tests/**/*` |

Ver [.claude/rules/README.md](.claude/rules/README.md) para detalles.

---

## Pre-Push Checklist

```bash
npm run test         # 100% tests OBLIGATORIO
npm run build        # Sin TypeScript errors
npm run lint -- --fix # Sin linting
git diff             # Cada línea = user request
```

**Si algún test falla → NO PUSHS.** Arregla el código.

---

## Key References

**Disciplina & Proceso:**
- [.claude/rules/behavioral-guidelines.md](.claude/rules/behavioral-guidelines.md) — 4 Reglas, Domain Invariants, ejemplos, FAQ
- [.claude/rules/api-patterns.md](.claude/rules/api-patterns.md) — Patrones de endpoints
- [.claude/rules/agent-patterns.md](.claude/rules/agent-patterns.md) — Patrones de Claude agent
- [.claude/rules/sheets-drive-patterns.md](.claude/rules/sheets-drive-patterns.md) — Google APIs seguro
- [.claude/rules/testing-strategy.md](.claude/rules/testing-strategy.md) — Estrategia Vitest

**Documentación Técnica:**
- [README.md](README.md) — Overview del proyecto
- [GUIA_IMPLEMENTACION.md](GUIA_IMPLEMENTACION.md) — Plan detallado (5 fases)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Diagramas de sistema
- [docs/API.md](docs/API.md) — Referencia de endpoints
- [docs/SETUP.md](docs/SETUP.md) — Pasos de setup en VPS

---

**Última actualización:** 2026-05-29 | **Versión:** 1.3 | **Estado:** Fase 1 ✅ + Fase 2 ✅ + Harness Engineering ✅
