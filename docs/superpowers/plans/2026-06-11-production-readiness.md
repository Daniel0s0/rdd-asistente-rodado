# Plan: Production Readiness — RDD Asistente Rodado

**Fecha:** 2026-06-11
**Objetivo:** Llevar RDD (asistente de registro de ingresos de causas del SaaS JPourney) de Fase 9.3 a producción en VPS, con flujo de trabajo confiable end-to-end.
**Modo de ejecución:** Cada etapa se ejecuta como un workflow ultracode (understand → implement → review adversarial → verify). Una etapa = una sesión/workflow. No mezclar etapas.

---

## Contexto (estado real al 2026-06-11)

- Código en **Fase 9.3** (webhooks con `pending_action`, agent con 5 tools, Supabase, UI React).
- 187 tests passing, build limpio, **24 commits sin pushear a origin/main**.
- Documentación (CLAUDE.md dice Fase 2, TASKS.md llega a 6.5) **muy desactualizada**.
- Auditoría de producción identificó 5 bloqueantes (ver Etapa 1-2) + deuda técnica manejable.

---

## Etapa 0 — Sincronización y baseline (manual, ~30 min, NO requiere ultracode)

**Done =** repo sincronizado, docs reflejan la realidad, baseline verde confirmado.

1. `npm run test && npm run build && npm run lint` → confirmar baseline verde.
2. `git push origin main` (24 commits pendientes).
3. Actualizar **CLAUDE.md**: fase actual (1–9.3 ✅), stack real (Supabase, no SQLite; UI React; Socket.io), estructura real de src/.
4. Actualizar **TASKS.md**: agregar secciones Fase 7–9.3 completadas + roadmap Etapas 1–5 de este plan.
5. Anotar en **PROGRESS.md**: decisión de congelar features y priorizar production-readiness.

---

## Etapa 1 — Robustez crítica (bloqueantes de producción)

**Done =** el proceso no muere silenciosamente, /health refleja dependencias reales, webhooks duplicados no corrompen datos. Tests para cada ítem.

### 1.1 Global error handling + graceful shutdown (`src/index.ts`)
- `process.on('unhandledRejection')` y `process.on('uncaughtException')` → log estructurado + exit(1) (PM2 reinicia).
- Graceful shutdown en SIGTERM/SIGINT: cerrar server HTTP, Socket.io y drenar requests en vuelo.

### 1.2 Health check integral (`src/api/health.ts`)
- `GET /health` → liveness simple (como hoy).
- `GET /health/ready` → readiness: ping Supabase (`select 1`), verificación de config Google (sin escribir en Sheets), estado general. 200 ok / 503 degraded con detalle por servicio.

### 1.3 Idempotencia de webhooks (`src/api/webhook.ts`)
- `causa-nueva` duplicado: detectar conversación existente por `causa_id` ANTES de crear carpeta Drive y fila Sheets → responder 200 con `{ duplicate: true }` (no 500, no duplicar fila en REGISTRO ni carpeta).
- `caso-cierre`/`caso-etapa`/`caso-modificacion` ya son updates (idempotentes por naturaleza) — agregar test que lo confirme.

### 1.4 PM2 config production-grade (`deployment/pm2.config.js`)
- Mantener `fork` + `instances: 1` (sistema single-user; cluster rompería Socket.io sin sticky sessions — NO seguir la sugerencia de `instances: 'max'`).
- Agregar: `kill_timeout: 15000`, `wait_ready: true` + `process.send('ready')` en index.ts, `log_date_format`, ruta de logs absoluta o pre-creada por script.

**Verificación de etapa:** suite completa verde + test manual: matar Supabase URL en .env → /health/ready responde 503; reenviar mismo webhook 2 veces → una sola fila/conversación.

---

## Etapa 2 — Pipeline de despliegue

**Done =** un push a main corre CI; el deploy al VPS es un procedimiento documentado y repetible con rollback.

### 2.1 CI con GitHub Actions (`.github/workflows/ci.yml`)
- En push/PR a main: `npm ci` → `type-check` → `lint` → `test` → `build`.

### 2.2 Migraciones de DB versionadas
- Crear `db/migrations/` con el schema actual de Supabase como migración 0001 (baseline).
- Script `npm run db:migrate` (Supabase CLI o script SQL idempotente con tabla `schema_versions`).
- Regla en CLAUDE.md: ningún cambio de schema fuera de migraciones.

### 2.3 Documentación y script de deploy
- `docs/DEPLOYMENT.md`: checklist completo (pull → install → build → migrate → pm2 reload → curl /health/ready), procedimiento de rollback (git checkout tag anterior + rebuild), y guía Nginx + Let's Encrypt para HTTPS delante del puerto 3001.
- `scripts/deploy.sh` que automatice el checklist en el VPS.

**Verificación de etapa:** CI verde en GitHub; dry-run del deploy script en local.

---

## Etapa 3 — Calidad y deuda técnica

**Done =** lint con 0 warnings, TDs documentados resueltos, logs trazables.

### 3.1 Limpieza de 71 warnings ESLint
- Interfaces tipadas para errores (GoogleError, SupabaseError, AnthropicError) en vez de `as any`.
- Focos: `src/agent/claude-agent.ts` (~16), `src/database/analytics-queries.ts` (~24), `src/config/env-loader.ts` (no-console → logger).

### 3.2 Deuda registrada en PROGRESS.md
- TD1: tests para `POST /agent/portfolio-chat`.
- TD3: detección de duplicate key por `error.code === '23505'` en vez de string matching.
- TD2 (race condition `__portfolio__`): documentar como aceptado (single-user) o resolver con upsert.

### 3.3 Request ID en logs
- Middleware que genera `request_id` (UUID) y lo inyecta en el child logger de Pino para correlación webhook → agent → DB → Sheets.

**Verificación de etapa:** `npm run lint` → 0 errors, 0 warnings; suite verde.

---

## Etapa 4 — Confiabilidad del flujo de ingresos (la finalidad del sistema)

**Done =** ningún ingreso/acuerdo/pago se pierde aunque Google Sheets o Anthropic fallen transitoriamente; el usuario recibe resumen proactivo.

### 4.1 Sincronización Sheets resiliente
- Hoy: si `appendRegistroRow()` falla tras crear la conversación, la fila se pierde sin reintento persistente.
- Implementar **outbox simple**: tabla `sheets_outbox` (payload, estado, intentos) + worker/cron que reintenta pendientes. El webhook nunca falla por culpa de Sheets.

### 4.2 Auditoría end-to-end del flujo financiero
- Revisar `shouldSyncSheets` y `sheetsSyncData` en `src/agent/tool-handlers.ts`: confirmar que acuerdos/pagos registrados vía tools llegan efectivamente a la tab REGISTRO (hoy el contrato existe pero verificar quién ejecuta el sync).
- Test de integración: webhook causa-nueva → chat "acordamos $2M en 4 cuotas" → verificar acuerdo + cuotas en DB + señal de sync.

### 4.3 Fase 10 — Session Digest (agente proactivo Rodado)
- Endpoint `GET /agent/digest` (+ comando en UI): resumen generado por Claude de (a) casos con `pending_action`, (b) cuotas vencidas o por vencer en 7 días, (c) acuerdos sin actividad.
- Opcional: cron diario que lo genera y lo deja disponible en el Dashboard.

**Verificación de etapa:** test E2E del flujo financiero completo; simulación de caída de Sheets → outbox reintenta y completa.

---

## Etapa 5 — Salida a producción

**Done =** RDD corriendo en el VPS recibiendo webhooks reales del SaaS.

1. Provisionar VPS: Node 18+, PM2, Nginx + certificado, `.env` de producción (secrets reales, `SENTRY_DSN` si se usa).
2. Ejecutar `scripts/deploy.sh` (Etapa 2.3).
3. Configurar en JPourney las URLs de webhook de producción + `SAAS_WEBHOOK_SECRET` compartido.
4. Smoke tests: causa de prueba end-to-end (webhook → Sheets → chat → acuerdo → analytics).
5. Monitoreo primera semana: `pm2 logs`, /health/ready, revisión de audit_log.

---

## Reglas de ejecución (todas las etapas)

- Cada etapa: plan detallado → implementación → `npm run test && npm run build && npm run lint` → code review (validator) → commit → actualizar PROGRESS.md/TASKS.md.
- Regla 3 (Surgical Changes): no refactorizar fuera del scope de la etapa.
- No avanzar a la etapa siguiente con la suite en rojo.
