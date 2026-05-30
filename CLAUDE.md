# CLAUDE.md - RDD: Asistente Rodado

Guía maestra para trabajar en RDD. **Disciplina:** Agent Orchestration + 4 Reglas inalterable + Domain Invariants + stack claro.

---

## 📊 Estado Actual

**Fase:** 1 (Infraestructura Base) ✅ → Fase 2 (Webhook Listener) ✅ → Próximo: [Fase 3 (Agent + DB)](GUIA_IMPLEMENTACION.md)  
**Completado:** src/config/, src/utils/, src/api/health, src/api/webhook, src/sheets/client, deployment/  
**En construcción:** src/agent/, src/database/, src/drive/ (según plan de implementación)

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

**Última actualización:** 2026-05-29 | **Versión:** 1.2 | **Estado:** Fase 1 ✅ + Fase 2 ✅
