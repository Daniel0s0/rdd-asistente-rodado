# Auto-Load Rules para RDD

Estos archivos auto-cargan en sesiones de Claude basado en patrones de archivo.

---

## Cómo Funciona

Cuando editas un archivo `.ts` o `.tsx`, las reglas aplicables auto-cargan automáticamente.

**Ejemplo:**
- Editas `src/api/webhook.ts` → `behavioral-guidelines.md` + `api-patterns.md` se cargan
- Editas `src/agent/claude-agent.ts` → `behavioral-guidelines.md` + `agent-patterns.md` se cargan
- Editas `tests/webhook.test.ts` → `behavioral-guidelines.md` + `testing-strategy.md` se cargan

---

## Rules Reference

| Archivo | Carga Cuando | Propósito |
|---------|-------------|----------|
| **behavioral-guidelines.md** | `src/**/*`, `tests/**/*` | Regla 0: Agent Orchestration + 4 Reglas: Think, Simplicity, Surgical, Goal-Driven |
| **api-patterns.md** | `src/api/**/*` | Endpoints, validación, error handling |
| **agent-patterns.md** | `src/agent/**/*` | Claude SDK, multi-turn, parsing |
| **sheets-drive-patterns.md** | `src/sheets/**/*`, `src/drive/**/*` | Google APIs, rate limiting, audit |
| **testing-strategy.md** | `tests/**/*` | Vitest, mocking, coverage |

---

## Ejemplo: Editando API Route

### 1. Abres `src/api/webhook.ts`

### 2. Auto-cargan:
- `behavioral-guidelines.md` (disciplina base)
- `api-patterns.md` (patrones de endpoints)

### 3. Ves:

**behavioral-guidelines.md:**
- Rule #1: Think Before Coding
- Rule #3: Surgical Changes
- No asumir sin claridad

**api-patterns.md:**
- Validación de entrada
- Webhook signature validation
- Error handling
- Response format

### 4. Implementas:
```typescript
// Validar entrada
validateInput(body);

// Validar firma
validateWebhookSignature(req, body);

// Procesar
const result = await processRequest(body);

// Responder
return NextResponse.json(result, { status: 201 });
```

---

## Ejemplo: Escribiendo Tests

### 1. Abres `tests/webhook.test.ts`

### 2. Auto-cargan:
- `behavioral-guidelines.md` (disciplina base)
- `testing-strategy.md` (cómo testear)

### 3. Ves:

**testing-strategy.md:**
- Mock Google APIs
- Test structure
- Running tests
- Common pitfalls

### 4. Escribes:
```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Webhook', () => {
  it('rejects invalid signature', () => {
    // Mock
    // Assert
  });
});
```

---

## Por Qué Esta Estructura

1. **Claridad:** No todas las reglas aplican a todos los archivos
2. **Onboarding:** Nuevo dev edita un file → entiende qué patterns aplican
3. **Disciplina:** Las reglas son contextuales, no generic
4. **Mantenibilidad:** Cambias una regla → aplica a todos los files relevantes

---

## Cuándo Leer Manualmente

Si no estás editando, pero quieres leer una regla:

```bash
cat .claude/rules/api-patterns.md        # Patrones de API
cat .claude/rules/agent-patterns.md       # Patrones de agent
cat .claude/rules/sheets-drive-patterns.md # Patrones Google APIs
cat .claude/rules/testing-strategy.md     # Estrategia tests
```

---

## Referencia Rápida

**¿Cuándo uso Explore Agent vs implementar directo?**  
→ Ver `behavioral-guidelines.md` (Sección 0: Agent Orchestration)  
→ TL;DR: Codebase compleja/desconocida → Explore. Ya sabés qué hacer → THIS session.

**¿Qué agentes debería usar en mi flujo de trabajo?**  
→ Ver `behavioral-guidelines.md` (Sección 0: Agent Orchestration)  
→ Flujo: Explore → Implement → Validate → Push

**¿Cómo valido entrada en endpoints?**  
→ Ver `api-patterns.md` (Validación de Entrada)

**¿Cómo uso Claude API?**  
→ Ver `agent-patterns.md` (Multi-Turn Architecture)

**¿Cómo mockeo Google Sheets en tests?**  
→ Ver `testing-strategy.md` (Mocking Google APIs)

**¿Qué son Domain Invariants?**  
→ Ver `behavioral-guidelines.md` (sección Domain Invariants)

---

Ver [CLAUDE.md](../CLAUDE.md) para visión general del proyecto.
