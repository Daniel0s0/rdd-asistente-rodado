# RDD: Asistente Rodado

**Agente conversacional autónomo para registro contable de causas legales.**

---

## 🎯 Propósito

RDD es un **agente de IA** que:

1. **Escucha webhooks** del SaaS cuando se crea una causa nueva
2. **Mantiene conversaciones** con el usuario (chat multi-turn)
3. **Registra ingresos** en Google Sheets (INGRESOS_CAUSAS)
4. **Almacena comprobantes** en Google Drive (carpetas existentes)
5. **Calcula automáticamente** honorarios, gastos, neto
6. **Actualiza paneles** (DASHBOARD, ANÁLISIS FINANCIERO, LIQUIDACIÓN)

**Vive en:** VPS (Node.js en puerto 3001)  
**Integración:** Webhook-only con SaaS (datos independientes)  
**Stack:** Node.js | TypeScript | Claude API | Google APIs | Vitest

---

## 🚀 Quick Start

```bash
# 1. Setup
cp .env.example .env           # Edita con tus secrets
npm install

# 2. Desarrollo local
npm run dev                    # localhost:3001

# 3. Tests (OBLIGATORIO antes de push)
npm run test

# 4. Deploy (VPS)
npm run build
npm run pm2:start
```

---

## 📋 Cómo Funciona

### Flujo Típico:

```
1. SaaS crea causa → Envia webhook a RDD
   { causa_id, cliente_nombre, drive_folder_id, demandado }

2. RDD recibe webhook → Crea row en REGISTRO de Sheets
   Responde al usuario: "Causa registrada. ¿Cuál es el resultado?"

3. Usuario envia: "Acuerdo de $500,000 en 5 cuotas"
   → RDD parsea con Claude: extrae montos, calcula vencimientos

4. RDD registra en Sheets:
   - REGISTRO: nueva fila con tipo=Acuerdo, monto=$500k
   - DASHBOARD: actualiza totales (sumo nuevo ingreso)
   - ANÁLISIS FIN.: recalcula distribución por tipo

5. Usuario sube comprobante (PDF)
   → RDD sube a Drive: /[Cliente]/[DEMANDADO]/acuerdo_pago.pdf
   → Actualiza Sheets con link

6. Usuario envia: "Recibí primer pago de $100,000"
   → RDD registra pago, calcula pendiente ($400k), responde
```

---

## 📁 Estructura del Proyecto

```
rdd-asistente-rodado/
│
├─ src/                         # Código fuente
│  ├─ api/                      # Endpoints (webhook, chat, health)
│  ├─ agent/                    # Claude logic + parsing
│  ├─ sheets/                   # Google Sheets API wrapper + sync
│  ├─ drive/                    # Google Drive API wrapper + upload
│  ├─ database/                 # Conversation store
│  ├─ types/                    # TypeScript definitions
│  ├─ utils/                    # Utilities, validators, formatters
│  ├─ config/                   # Environment + constants
│  └─ index.ts                  # Entry point
│
├─ tests/                       # Vitest test suites
│  ├─ unit/
│  └─ integration/
│
├─ .claude/                     # Claude Code configuration
│  └─ rules/                    # Auto-loading discipline rules
│     ├─ behavioral-guidelines.md
│     ├─ api-patterns.md
│     ├─ agent-patterns.md
│     ├─ sheets-drive-patterns.md
│     └─ testing-strategy.md
│
├─ docs/                        # Documentation
│  ├─ ARCHITECTURE.md           # Diagramas y decisiones
│  ├─ API.md                    # Referencia de endpoints
│  ├─ SETUP.md                  # Pasos de setup en VPS
│  └─ TROUBLESHOOTING.md        # Problemas comunes
│
├─ deployment/                  # Production config
│  ├─ pm2.config.js             # PM2 configuration
│  ├─ Dockerfile                # Docker image (opcional)
│  └─ .env.production            # Prod environment
│
├─ CLAUDE.md                    # Guía maestro (disciplina + stack)
├─ GUIA_IMPLEMENTACION.md       # Plan detallado (5 fases)
├─ package.json
├─ tsconfig.json
└─ .env.example                 # Template de variables
```

---

## 📖 Cómo Trabajar en RDD

RDD tiene **disciplina estricta** (igual al SaaS):

### ⚡ 4 Reglas Inalterable

1. **Think Before Coding** — Usa `EnterPlanMode` para CADA cambio
2. **Simplicity First** — Solo código pedido, sin especulaciones
3. **Surgical Changes** — Toca SOLO lo necesario
4. **Goal-Driven Execution** — Define "done" antes de codificar

### 📋 Pre-Push Checklist

```bash
npm run test        # 100% tests deben PASAR (OBLIGATORIO)
npm run build       # Sin TypeScript errors
npm run lint --fix  # Sin linting errors
git diff            # Cada línea = user request
```

**Si algún test falla → NO PUSHS.**

---

## 🔧 Core Commands

| Comando | Propósito |
|---------|-----------|
| `npm run dev` | Servidor local (puerto 3001) |
| `npm run test` | Todos los tests (OBLIGATORIO) |
| `npm run test -- <pattern>` | Tests específicos |
| `npm run lint -- --fix` | Lint + format |
| `npm run build` | Compilar TypeScript |
| `pm2 start ecosystem.config.js` | Producción |

---

## 📚 Documentación

- **[CLAUDE.md](CLAUDE.md)** — Guía maestro (stack, reglas, invariants)
- **[GUIA_IMPLEMENTACION.md](GUIA_IMPLEMENTACION.md)** — Plan detallado (5 fases)
- **[.claude/rules/README.md](.claude/rules/README.md)** — Auto-loading rules
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Arquitectura de sistema
- **[docs/API.md](docs/API.md)** — Referencia de endpoints
- **[docs/SETUP.md](docs/SETUP.md)** — Setup en VPS

---

## 🔐 Seguridad

**Domain Invariants (No Negociables):**

1. **Webhook Signature Validation** — NUNCA sin validar `SAAS_WEBHOOK_SECRET`
2. **Google Service Account ONLY** — Auth Google = service account
3. **Claude Multi-Turn Context** — Siempre cargar historial completo
4. **Sheets Sync Atomicity** — TODO o NADA (no estados intermedios)
5. **Respetar Estructura SaaS** — Drive: `/[Cliente]/[DEMANDADO]/`
6. **Rate Limiting** — Queue + retry con backoff exponencial
7. **Validación Financiera** — Validar antes de guardar en Sheets
8. **Audit Logging** — Log WHO/WHEN/WHAT para compliance
9. **Error Recovery** — Si falla a mitad, ROLLBACK todo

Ver [CLAUDE.md](CLAUDE.md#domain-invariants) para detalles.

---

## 🚀 Fases de Implementación

```
Fase 1: Infraestructura Base (30 min)
├─ Express server, env config, logging

Fase 2: Webhook Listener (1 hora)
├─ POST /webhook/causa-nueva, signature validation, Sheets row creation

Fase 3: Chat API + Claude Agent (2 horas)
├─ POST /api/chat, multi-turn conversations, intent parsing

Fase 4: Google Sheets Sync (1.5 horas)
├─ REGISTRO updates, DASHBOARD recalc, ANÁLISIS FIN.

Fase 5: Google Drive Integration (1 hora)
├─ Upload comprobantes, validación, URL linking
```

Ver [GUIA_IMPLEMENTACION.md](GUIA_IMPLEMENTACION.md) para plan completo.

---

## ❓ FAQ

**¿Dónde vive RDD?**  
En el VPS, puerto 3001. Separado del SaaS (puerto 3000).

**¿Cómo se integra con SaaS?**  
Webhook-only: SaaS envia POST a `/webhook/causa-nueva` con causa data.

**¿Qué es Google Sheets INGRESOS_CAUSAS?**  
Base de datos externa (no Supabase) para registro financiero. Sheets tiene 6 pestañas: DASHBOARD, REGISTRO, ANÁLISIS FIN., LIQUIDACIÓN, REPORTES, CONFIGURACIÓN.

**¿Qué es CLAUDE.md?**  
Guía maestro de disciplina. 4 Reglas + stack + Domain Invariants. Lée antes de empezar.

**¿Tests son obligatorios?**  
SÍ. 100% must pass antes de push.

---

## 🤝 Contribuir

1. Lee [CLAUDE.md](CLAUDE.md) (5 min)
2. Crea feature branch: `git checkout -b feature/nombre`
3. Edita código
4. `npm run test` (100% pass)
5. `git commit -m "..."` 
6. PR

---

## 📞 Soporte

- Problemas comunes → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- Arquitectura → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Endpoints → [docs/API.md](docs/API.md)
- Reglas → [.claude/rules/README.md](.claude/rules/README.md)

---

**Última actualización:** 2026-05-29  
**Versión:** 1.0  
**Estado:** Fase 0 (Framework) ✅ → Fase 1 (próximo)
