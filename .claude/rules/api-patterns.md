---
paths: ["src/api/**/*"]
---

# API Patterns para RDD

Patrones seguros para endpoints HTTP.

---

## Estructura Base de Endpoint

```typescript
export async function POST(req: Request): Promise<NextResponse> {
  try {
    // 1. Validar entrada
    const body = await req.json();
    validateInput(body);

    // 2. Autenticar (webhook signature, etc.)
    validateWebhookSignature(req, body);

    // 3. Procesar lógica
    const result = await processRequest(body);

    // 4. Responder
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    // 5. Error handling
    logger.error('[ENDPOINT]', error);
    return errorResponse(error);
  }
}
```

---

## Validación de Entrada

**NUNCA confíes en input del usuario o webhooks sin validar:**

```typescript
// ❌ WRONG
const { causa_id, monto } = await req.json();
await sheets.updateCausa(causa_id, monto);  // ¿Y si causa_id = null?

// ✅ CORRECT
const { causa_id, monto } = await req.json();
if (!causa_id || typeof causa_id !== 'string') {
  throw new ValidationError('causa_id requerido');
}
if (typeof monto !== 'number' || monto <= 0) {
  throw new ValidationError('monto debe ser > 0');
}
await sheets.updateCausa(causa_id, monto);
```

---

## Webhook Signature Validation

**NUNCA proceses webhook sin validar firma:**

```typescript
function validateWebhookSignature(req: Request, body: any) {
  const signature = req.headers.get('x-webhook-signature');
  if (!signature) {
    throw new UnauthorizedError('Missing webhook signature');
  }

  const computed = crypto
    .createHmac('sha256', process.env.SAAS_WEBHOOK_SECRET!)
    .update(JSON.stringify(body))
    .digest('hex');

  if (signature !== computed) {
    throw new UnauthorizedError('Invalid webhook signature');
  }
}
```

---

## Error Handling

**Responde con status code correcto:**

```typescript
// 400 Bad Request — usuario error
if (!causaId) return errorResponse('causa_id requerido', 400);

// 401 Unauthorized — signature/auth fallo
if (!validSignature) return errorResponse('Invalid signature', 401);

// 409 Conflict — recurso ya existe
if (existingRow) return errorResponse('Causa already registered', 409);

// 500 Internal Server Error — algo nuestro explotó
if (googleApiError) return errorResponse('Internal error', 500);
```

---

## Logging Patterns

**Loguea para debugging:**

```typescript
logger.info('[WEBHOOK] Received causa_id=' + causaId);
logger.debug('[WEBHOOK] Payload:', { causa_id, cliente, demandado });
logger.error('[WEBHOOK] Failed to sync Sheets:', error.message);

// Nunca loguees credenciales:
// ❌ logger.debug('Google key:', process.env.GOOGLE_KEY);
// ✅ logger.debug('Google auth initialized');
```

---

## Response Format

Responde siempre con estructura consistente:

```typescript
// Success (201)
{
  "success": true,
  "causa_id": "...",
  "message": "Causa registrada",
  "actions": [
    { "type": "sheets_update", "status": "completed" },
    { "type": "drive_upload", "status": "completed" }
  ]
}

// Error (400, 401, 500)
{
  "success": false,
  "error": "campo_requerido",
  "message": "causa_id es requerido",
  "timestamp": "2026-05-29T19:30:00Z"
}
```

---

## Rate Limiting Awareness

**Google APIs tiene límites. Prepárate:**

```typescript
// Si Google returns 429 (Too Many Requests):
// - Queue el request
// - Retry con backoff exponencial
// - NO falles inmediatamente

async function callGoogleWithRetry(fn: () => Promise<any>) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 429 && attempt < 2) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }
}
```

---

## Atomicity (TODO o NADA)

Si actualizar Sheets falla después de subir a Drive, **rollback todo:**

```typescript
try {
  const driveFileId = await drive.upload(buffer);
  const sheetUpdated = await sheets.updateRow({
    driveFileId,
    // ...
  });
  
  if (!sheetUpdated) {
    // Sheets falló, elimina el archivo de Drive
    await drive.deleteFile(driveFileId);
    throw new Error('Sheets sync failed, rolled back Drive upload');
  }
} catch (error) {
  logger.error('[WEBHOOK] Rollback:', error);
  throw error;
}
```

---

## Health Check Endpoint

Implementa un health check para monitoreo:

```typescript
export async function GET(req: Request) {
  return NextResponse.json({
    status: 'ok',
    uptime: process.uptime(),
    services: {
      claude_api: await checkClaudeAPI(),
      google_sheets: await checkGoogleSheets(),
      google_drive: await checkGoogleDrive(),
    },
    timestamp: new Date().toISOString()
  });
}
```
