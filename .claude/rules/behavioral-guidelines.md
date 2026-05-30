---
paths: ["src/**/*", "tests/**/*"]
---

# Behavioral Guidelines para RDD

**Disciplina inalterable.** Estas reglas gobiernan CADA sesión de trabajo en RDD.

---

## 0. Agent Orchestration (Mantén el Contexto Limpio)

RDD es proyecto complejo. Para mantener contexto limpio y productivo, orquesta tareas entre agentes especializados:

### 🔍 Explore Agent — Lectura & Investigación
Úsalo SIEMPRE que necesites:
- Exploración extensiva de codebase
- Análisis de patrones existentes
- Búsqueda de símbolos, referencias, arquitectura
- Entender cómo se hace algo en el proyecto actual
- Investigar múltiples files sin saturar main session

**Cuándo:** "¿Cómo se parsea el webhook?" → Lanza Explore. No polutes THIS context.

### 💻 Main Session (This Session) — Implementación
Tu sesión principal:
- Usa findings del Explore Agent
- Escribe código basándote en investigación
- Tests básicos y verificación local
- Decisiones arquitectónicas (con EnterPlanMode)

**Cuándo:** Ya sabés qué hacer → implementá acá.

### ✅ Code Solution Validator Agent — Revisión & Validación
Úsalo ANTES de push para:
- Validar cambios respetan arquitectura
- Verificar tests pasen + coverage
- Asegurar Domain Invariants NO se rompieron
- Catch edge cases antes de deployment
- Revisar que cada línea = user request

**Cuándo:** Terminaste código → pasa por validador antes de git push.

### ¿Por Qué Este Flujo?

| Beneficio | Cómo Lo Logra |
|-----------|--------------|
| 🧠 Contexto limpio | Explore agent no poluta main session con logs enormes |
| ⚡ Paralelización | Explore corre mientras implementás |
| 🎯 Especialización | Cada agente sabe su trabajo, mejor output |
| 🚫 Menos rewrites | Validar ANTES de pushear = menos mistakes |
| 📊 Trazabilidad | Cada agente genera output que documentas |

### Ejemplo Completo

```
User: "Implementar validación de webhook"

1️⃣ EXPLORE: Lanzas Explore Agent
   → Busca: "¿cómo se validan webhooks en RDD?"
   → Output: "Validación en api-patterns.md, usa HMAC-SHA256"
   → Contexto: Limpio (sin log de 50 búsquedas)

2️⃣ IMPLEMENT: En THIS session
   → Usas findings de Explore
   → Escribís validateWebhookSignature()
   → Tests pasan localmente
   → Code está ready

3️⃣ VALIDATE: Code Solution Validator Agent
   → Revisa: ¿respeta patterns? ¿tests 100%? ¿invariants?
   → Output: "APROBADO" o "Fix: X antes de pushear"
   → Ajustas si es necesario

4️⃣ PUSH: Confidently
   → git commit + push
   → Sabés que está validado
```

---

## 1. Think Before Coding (No Assumptions)

Cuando recibes una tarea:

- **Clarifica ambigüedad.** Si hay múltiples interpretaciones, preséntala.
  - "¿El webhook debería reintentar automáticamente o fallar inmediatamente?"
  - "¿Querés que RDD auto-detect el tipo de ingreso o que el usuario lo especifique?"
- **Si incierto sobre arquitectura, pregunta.** No asumir.
  - "¿Las conversaciones van en SQLite o Postgres?"
  - "¿Dónde debería vivir la lógica de validación: en parser o en sync?"
- **No proceeds sin plan.** Usa EnterPlanMode antes de escribir línea 1.

### En RDD específicamente:
- Los 9 Domain Invariants son **no negociables.** No los bypasses.
- Google API auth = service account ALWAYS. No OAuth interactivo.
- Webhook signature validation NUNCA optional. Siempre validar.

---

## 2. Simplicity First (Minimum Viable Code)

- **No features más allá de lo pedido.** User dijo "validar webhook" → valida webhook. No agreges retry logic si no pidieron.
- **No abstracciones para single-use.** Función usada 1 vez = queda en el file donde se usa.
- **No "por si acaso" flexibility.** Config layers, feature flags, si no pidieron → delete.
- **No error handling para escenarios imposibles.** Trust invariants.

### Test yourself:
- ¿Un senior engineer llamaría esto overcomplicated? → Rewrite.
- ¿Esta línea trazable al user request? Si no → borra.
- ¿Creé un file nuevo cuando podría usar uno existente? → Consolidate.

---

## 3. Surgical Changes (Touch Only What's Necessary)

**Cada línea que cambias debe servir el goal del user. Todo lo demás es noise.**

- **No "improve" código adjacent.** Estás arreglando webhook y ves mal style en agent.ts? → Menciona. No fixes.
- **No refactorices sin pedirlo.** Consistency patches no son parte de la tarea.
- **Match existing style.** Si SaaS usa `const { data: { user } }` → usa igual en RDD.
- **Clean up solo tu propio mess.** TÚ generaste la línea innecesaria? Borra. Existía antes? Leave it.

### The Test:
**Cada línea modificada traza directamente al user request.** Si cambiaste 50 líneas pero solo 5 arreglan el problema → **failed.**

---

## 4. Goal-Driven Execution (Verifiable Success)

**Antes de codificar, define QUÉ "done" es.**

### Transform tasks into verifiable goals:

```
"Implementar validación de webhook"
→ "POST /webhook rechaza signature inválida (401), 
   acepta válida (201), crea row en Sheets"
```

```
"Hacer que Claude entienda acuerdos"
→ "Agent parsea 'acuerdo $500k 5 cuotas' → 
   extrae montos, calcula fechas de vencimiento, 
   responde confirmación"
```

### Para multi-step tasks, state brief plan:
```
1. [Implementar X] → verificar: [test pass]
2. [Integrar con Y] → verificar: [E2E test]
3. [Documentar] → verificar: [docs completos]
```

### Pre-push checklist:
- ✅ `npm run test` — 100% pass (OBLIGATORIO)
- ✅ `npm run build` — Sin TypeScript errors
- ✅ `npm run lint -- --fix` — Sin linting
- ✅ `git diff` — Cada línea = user request
- ✅ Invariants checklist — ¿Validé webhooks? ¿Manejo errores? ¿Rate limit?

---

## Red Flags (Stop If You See These)

- Estás agregando una config layer que no existe en el codebase
- Refactorizando código que el user no pidió
- Creando una abstracción para single-use
- Escribiendo error handling para imposibles
- Cambiando 50 líneas cuando 10 resuelven el problema
- Proceediendo sin claridad arquitectónica
- "Mejorando" style fuera del scope

**Si ves alguno → STOP y pregunta.**

---

## Success Looks Like

✅ Menos cambios innecesarios  
✅ Menos rewrites por over-engineering  
✅ Clarificaciones ANTES de fallos  
✅ Cada commit traza a user request  
✅ RDD es limpio, mantenible, robusto

---

**Aplicación en RDD:** 
- Piensa ANTES de tocar Google APIs (requieren planeación)
- Simplifica agent logic (no hagas Claude hacer demasiado)
- Cada cambio → test automático (Goal-Driven)
- Invariants NUNCA negotiable

---

## Domain Invariants (No Negociables)

Estas reglas **NUNCA se rompen.** Si una tarea las viola, **STOP y clarifica.**

| Invariant | Por Qué | Si Lo Rompes = ? |
|-----------|--------|-----------------|
| **Webhook Signature Validation** | Validar `SAAS_WEBHOOK_SECRET` siempre | Procesamos webhooks falsos → datos corruptos |
| **Google Service Account ONLY** | Auth Google = service account, never OAuth | Credenciales expuestas, acceso no autorizado |
| **Claude Multi-Turn Context** | Cargar historial COMPLETO de conversación | Contexto perdido, RDD no entiende usuario |
| **Sheets Sync Atomicity** | Actualizar TODO o NADA (no estados intermedios) | Datos inconsistentes entre REGISTRO, DASHBOARD, etc. |
| **Respetar Estructura SaaS** | Drive: `/[Cliente]/[DEMANDADO]/` (no crear carpetas) | Desorganización de Drive, no encontramos comprobantes |
| **Rate Limiting en Google APIs** | Queue + retry con backoff exponencial | Google throttles (429), perdemos webhooks/datos |
| **Validación de Datos Financieros** | Validar antes de guardar: montos ≥ 0, % ≤ 100, fechas lógicas | DASHBOARD rompe con cálculos imposibles |
| **Audit Logging de Cambios** | Log WHO/WHEN/WHAT para compliance | No sabemos quién cambió qué, discrepancias sin trazabilidad |
| **Error Recovery Automático** | Si Google falla a mitad, ROLLBACK todo (delete Drive, revert Sheets) | Estados corruptos, datos a medio camino |

---

## Ejemplos Prácticos

### ✅ Tarea Bien Planificada

```
User: "Quiero que el webhook valide la firma del SaaS"

Claude:
1. EnterPlanMode → Design validation strategy
2. Clarify: "¿Qué secret usás para HMAC?"
3. Plan: Implementar validateWebhookSignature() en src/api/webhook.ts
4. Tests: Mock signature válida, firma inválida
5. Código → Tests PASS → ExitPlanMode → Aprobación
```

### ❌ Tarea Mal Abordada

```
User: "Quiero que el webhook valide la firma del SaaS"

Claude (MAL):
1. Empiezo a codificar sin plan
2. No tengo test para firma inválida
3. Se me olvida loguear el rechazo
4. Pusheo con tests fallando → Violé Goal-Driven Execution
```

---

## Diferencias RDD vs SaaS

Contexto: RDD es separado del SaaS pero integrado vía webhooks.

| Aspecto | SaaS | RDD |
|---------|------|-----|
| **Propósito** | Gestión integral de casos | Registro ingresos + chat |
| **Frontend** | React 19 (components) | API REST (sin UI aquí) |
| **Auth** | Supabase + roles (Captador, Abogado, Admin) | Webhook signature + no user roles |
| **DB** | Supabase (RLS critical) | SQLite/Postgres (conversaciones) |
| **Tests** | Role-based testing | Webhook mocking, agent parsing |
| **Invariants críticos** | RLS, lead_estado ≠ estado | Webhook validation, Google service account |

---

## FAQ

**P: ¿Siempre tengo que usar EnterPlanMode?**  
**A:** SÍ. CADA feature, CADA fix, CADA cambio. Sin excepciones.

**P: ¿Qué pasa si los tests fallan?**  
**A:** NO PUSHS. Arregla el código hasta que pasen. Tests = requisito, no sugerencia.

**P: ¿Puedo "mejorar" código mientras arreglo mi feature?**  
**A:** NO. Surgical Changes. Solo toca lo que el user pidió. Si ves otro problema → menciona en PR description.

**P: ¿Qué es un Domain Invariant?**  
**A:** Una regla que NUNCA se rompe. Ejemplo: "Webhook signature SIEMPRE validada". Si la quiebras → disaster.
