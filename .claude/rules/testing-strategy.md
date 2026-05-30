---
paths: ["tests/**/*"]
---

# Testing Strategy para RDD

Vitest patterns para tests confiables.

---

## Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateWebhookSignature } from '../api/webhook';

describe('Webhook Validation', () => {
  let mockRequest: any;
  
  beforeEach(() => {
    mockRequest = {
      headers: new Map(),
      body: { causa_id: 'test-123' }
    };
  });
  
  it('should reject invalid signature', () => {
    mockRequest.headers.set('x-webhook-signature', 'invalid');
    
    expect(() => 
      validateWebhookSignature(mockRequest, mockRequest.body)
    ).toThrow('Invalid webhook signature');
  });
  
  it('should accept valid signature', () => {
    const validSignature = crypto
      .createHmac('sha256', process.env.SAAS_WEBHOOK_SECRET!)
      .update(JSON.stringify(mockRequest.body))
      .digest('hex');
    
    mockRequest.headers.set('x-webhook-signature', validSignature);
    
    expect(() => 
      validateWebhookSignature(mockRequest, mockRequest.body)
    ).not.toThrow();
  });
});
```

---

## Mocking Google APIs

**NUNCA hagas calls reales a Google en tests:**

```typescript
import { vi } from 'vitest';

// Mock Google Sheets
const mockSheets = {
  spreadsheets: {
    values: {
      update: vi.fn(),
      append: vi.fn(),
      get: vi.fn()
    }
  }
};

// Mock Google Drive
const mockDrive = {
  files: {
    create: vi.fn(),
    get: vi.fn(),
    list: vi.fn()
  }
};

// En tu test:
vi.mock('googleapis', () => ({
  google: {
    sheets: () => mockSheets,
    drive: () => mockDrive,
    auth: { GoogleAuth: vi.fn() }
  }
}));
```

---

## Unit Tests

Test individual functions:

```typescript
describe('Financial Calculations', () => {
  it('calculates honorarios correctly', () => {
    const monto = 500000;
    const porcentaje = 20;
    const expected = 100000;
    
    const result = calculateHonorarios(monto, porcentaje);
    expect(result).toBe(expected);
  });
  
  it('rejects invalid honorarios percentage', () => {
    expect(() => 
      calculateHonorarios(500000, 150)  // > 100%
    ).toThrow('Porcentaje inválido');
  });
});

describe('Message Parsing', () => {
  it('detects acuerdo from user message', () => {
    const message = 'Tenemos acuerdo de $500,000 en 5 cuotas';
    const intent = parseIntent(message);
    
    expect(intent.type).toBe('agreement');
    expect(intent.data.monto).toBe(500000);
    expect(intent.data.cuotas).toBe(5);
  });
});
```

---

## Integration Tests

Test full flows:

```typescript
describe('Webhook Flow', async () => {
  it('should register causa and create Sheets row', async () => {
    // 1. Setup
    const webhook = {
      causa_id: 'test-123',
      cliente_nombre: 'Test Client',
      drive_folder_id: 'folder_xyz',
      demandado: 'John Doe'
    };
    
    // 2. Mock Google responses
    mockSheets.spreadsheets.values.append.mockResolvedValue({
      data: { updatedRows: 1 }
    });
    
    // 3. Execute
    const response = await POST(mockRequest);
    
    // 4. Assert
    expect(response.status).toBe(201);
    expect(mockSheets.spreadsheets.values.append).toHaveBeenCalled();
    const callArgs = mockSheets.spreadsheets.values.append.mock.calls[0];
    expect(callArgs[0].requestBody.values[0][0]).toBe('test-123');
  });
});

describe('Chat Flow', async () => {
  it('should parse acuerdo and register in Sheets', async () => {
    // 1. Setup conversation
    const causaId = 'test-123';
    const userMessage = 'Acuerdo de $500k en 5 cuotas';
    
    // 2. Chat
    const response = await chatWithRDD(causaId, userMessage);
    
    // 3. Assert Sheets was called
    expect(mockSheets.spreadsheets.values.update).toHaveBeenCalled();
    expect(response).toContain('✅ Registrado');
  });
});
```

---

## Snapshot Tests (Opcional)

Para respuestas estructuradas:

```typescript
it('should return correct response format', async () => {
  const response = await POST(mockRequest);
  
  expect(response).toMatchSnapshot();
  // Snapshot:
  // {
  //   "success": true,
  //   "causa_id": "test-123",
  //   "message": "Causa registrada"
  // }
});
```

---

## Running Tests

```bash
# Todos los tests
npm run test

# Tests específicos
npm run test -- webhook          # Tests con "webhook" en el nombre
npm run test -- agent --watch   # Watch mode
npm run test -- --reporter=verbose
npm run test -- --coverage       # Coverage report

# Antes de push (OBLIGATORIO)
npm run test                     # 100% must pass
```

---

## Test Coverage Goals

- **src/api/** → 100% (crítico: webhooks)
- **src/agent/** → 95%+ (parsing, intent detection)
- **src/sheets/** → 90%+ (validación antes de sync)
- **src/drive/** → 85%+ (upload patterns)
- **src/utils/** → 80%+ (helpers)

---

## Common Pitfalls

❌ **Calling real Google APIs in tests**
```typescript
// WRONG
await sheets.spreadsheets.values.update(...)  // Real call
```

✅ **Mock all external services**
```typescript
// CORRECT
mockSheets.spreadsheets.values.update.mockResolvedValue(...)
```

❌ **Testing without valid data**
```typescript
// WRONG
parseIntent(null)  // What happens?
```

✅ **Test edge cases**
```typescript
// CORRECT
parseIntent('')           // Empty
parseIntent('...garbage') // Invalid
parseIntent('acuerdo')    // Valid
```

❌ **Async without await**
```typescript
// WRONG
it('async test', () => {
  const result = callAsync();  // Unresolved promise
});
```

✅ **Explicit async handling**
```typescript
// CORRECT
it('async test', async () => {
  const result = await callAsync();
  expect(result).toBe(...);
});
```
