---
paths: ["src/agent/**/*"]
---

# Agent Patterns para RDD

Cómo usar Claude SDK de forma segura y efectiva.

---

## Multi-Turn Conversation Architecture

**NUNCA asumir contexto fresco.** Siempre cargar historial previo:

```typescript
import { Anthropic } from '@anthropic-ai/sdk';

const client = new Anthropic();

async function chatWithRDD(causaId: string, userMessage: string) {
  // 1. Cargar historial COMPLETO
  const history = await conversationStore.getMessages(causaId);
  
  // 2. Construir messages array (todos los turns previos + nuevo)
  const messages = [
    ...history.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    { role: 'user', content: userMessage }
  ];
  
  // 3. Llamar Claude con contexto completo
  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: messages
  });
  
  // 4. Guardar mensajes en store
  await conversationStore.saveMessage(causaId, 'user', userMessage);
  const assistantMessage = response.content[0].text;
  await conversationStore.saveMessage(causaId, 'assistant', assistantMessage);
  
  return assistantMessage;
}
```

---

## System Prompt Design

**Define rol y comportamiento de RDD:**

```typescript
const SYSTEM_PROMPT = `
Eres RDD (Asistente Rodado), un agente contable especializado en registro de ingresos de causas legales.

CONTEXTO:
- Trabaja con bufete de abogados que cobra del demandado (no del cliente)
- Mantienes registro de montos recuperados, gastos, honorarios, pagos a cliente
- Conversas en español (tono profesional pero accesible)

TAREA:
Ayudar al usuario a registrar ingresos y estados de causas en Google Sheets.

CAPACIDADES:
1. Interpretar descripciones de acuerdos/pagos: "acuerdo $500k en 5 cuotas"
2. Extraer datos: montos, números de cuotas, fechas
3. Calcular: honorarios = monto × %, neto = monto - gastos - honorarios
4. Registrar en Sheets y subir comprobantes a Drive

RESTRICCIONES:
- Solo acepto montos > 0 y porcentajes entre 0-100%
- Las fechas deben ser lógicas (fecha pago >= fecha acuerdo)
- Si falta información, pregunta en lugar de asumir
- Siempre confirma lo que registraste

CUANDO REGISTRES ACUERDO:
Responde: "✅ Registrado: [tipo], monto=$X, [detalles]. ¿Tienes comprobante?"

CUANDO REGISTRES PAGO:
Responde: "✅ Registrado: Pago de $X. Pendiente: $Y en Z cuotas. ¿Siguiente?"
`;
```

---

## Message Parsing (Intent Detection)

**Interpreta intención del usuario:**

```typescript
async function parseUserMessage(message: string, history: Message[]) {
  // Contexto histórico
  const lastCausaState = history[history.length - 1]?.metadata?.causaState;
  
  // Detectar intención por keywords
  if (message.match(/acuerdo|pactado|$\d+\s*k/i)) {
    return { type: 'agreement', subtype: 'new_agreement' };
  }
  if (message.match(/pago|transferencia|recibí|cuota/i)) {
    return { type: 'payment', subtype: 'payment_received' };
  }
  if (message.match(/gasto|arancel|perito/i)) {
    return { type: 'expense', subtype: 'expense_entry' };
  }
  if (message.match(/¿.*estado|qué.*pendiente|resumen/i)) {
    return { type: 'query', subtype: 'status_inquiry' };
  }
  
  return { type: 'unknown', subtype: null };
}
```

---

## Data Extraction

**Parseá números, fechas, montos:**

```typescript
import Decimal from 'decimal.js';

function extractFinancialData(message: string) {
  // Monto: busca "$" o "CLP" seguido de número
  const montoMatch = message.match(/\$?\s*(\d+(?:\s*\d+)*(?:\.\d+)?)\s*(?:k|mil)?/i);
  const monto = montoMatch 
    ? new Decimal(montoMatch[1].replace(/\s/g, '')).times(
        montoMatch[0].includes('k') ? 1000 : 1
      ).toNumber()
    : null;
  
  // Cuotas: busca "5 cuotas" o "en 5 veces"
  const cuotasMatch = message.match(/(\d+)\s*cuota/i);
  const cuotas = cuotasMatch ? parseInt(cuotasMatch[1]) : null;
  
  // Frecuencia: mensual, bimensual, trimestral
  const frecuencia = 'mensual'; // Default
  
  return {
    monto,
    cuotas,
    montoPorCuota: monto && cuotas ? monto / cuotas : null,
    frecuencia
  };
}
```

---

## Action Execution

**Ejecuta acciones basadas en intención:**

```typescript
async function executeAction(intent: Intent, data: ExtractedData) {
  switch (intent.type) {
    case 'agreement':
      return await registerAgreement(data);
    
    case 'payment':
      return await registerPayment(data);
    
    case 'expense':
      return await registerExpense(data);
    
    case 'query':
      return await queryStatus(data);
    
    default:
      return null;  // No action needed
  }
}

async function registerAgreement(data) {
  // 1. Validar
  if (!data.monto || data.monto <= 0) {
    throw new ValidationError('Monto debe ser > 0');
  }
  
  // 2. Calcular
  const montoPorCuota = data.monto / data.cuotas;
  const vencimientos = generatePaymentDates(
    new Date(),
    data.cuotas,
    data.frecuencia
  );
  
  // 3. Actualizar Sheets
  await sheets.addRow({
    tipo: 'Acuerdo',
    monto: data.monto,
    cuotas: data.cuotas,
    montoPorCuota,
    vencimientos
  });
  
  // 4. Responder
  return {
    success: true,
    message: `✅ Registrado: Acuerdo de $${data.monto.toLocaleString()} en ${data.cuotas} cuotas`,
    nextQuestion: '¿Tienes el PDF del acuerdo para guardar?'
  };
}
```

---

## Error Recovery

**Si Claude falla o no entiende:**

```typescript
async function handleAgentError(error: Error, context) {
  logger.error('[AGENT] Error:', error.message);
  
  // Diferentes estrategias por tipo de error
  if (error instanceof ValidationError) {
    return {
      success: false,
      message: `Validación fallida: ${error.message}`,
      nextQuestion: '¿Podrías verificar los datos y reintentar?'
    };
  }
  
  if (error instanceof ContextError) {
    return {
      success: false,
      message: 'No tengo contexto suficiente',
      nextQuestion: '¿Es esta la causa 123e4567? ¿Cuál es el estado actual?'
    };
  }
  
  // Fallback: usuario decides qué hacer
  return {
    success: false,
    message: 'No logré procesar tu mensaje',
    nextQuestion: '¿Podrías decirlo de otra forma?'
  };
}
```

---

## Validación Pre-Sheets

**Nunca envíes datos inválidos a Sheets:**

```typescript
const VALIDATION_RULES = {
  monto: (v: any) => typeof v === 'number' && v > 0,
  porcentajeHonorarios: (v: any) => typeof v === 'number' && v >= 0 && v <= 100,
  cuotas: (v: any) => typeof v === 'number' && v > 0 && v === Math.floor(v),
  fecha: (v: any) => v instanceof Date && v >= new Date('2020-01-01'),
};

function validateBeforeSheets(data: FinancialData) {
  for (const [field, value] of Object.entries(data)) {
    const rule = VALIDATION_RULES[field];
    if (rule && !rule(value)) {
      throw new ValidationError(`${field} es inválido: ${value}`);
    }
  }
}
```
