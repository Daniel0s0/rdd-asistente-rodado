# RDD: Asistente Rodado - Guía de Configuración e Implementación

**Versión:** 1.0  
**Fecha:** 2026-05-29  
**Propósito:** Agente autónomo de registro contable y gestión de ingresos de causas  
**Integración:** Webhook desde SaaS legal-journey-saas  
**Almacenamiento:** Google Sheets (INGRESOS_CAUSAS) + Google Drive (comprobantes)

---

## 📋 Resumen Ejecutivo

**RDD** es un agente conversacional que:
1. **Escucha webhooks** del SaaS cuando se crea una nueva causa
2. **Mantiene conversación** con el usuario (chat multi-turn)
3. **Registra ingresos financieros** en Google Sheets
4. **Almacena comprobantes** en Google Drive (carpetas existentes de causas)
5. **Calcula honorarios, gastos, neto** automáticamente
6. **Actualiza paneles** (DASHBOARD, ANÁLISIS FINANCIERO, LIQUIDACIÓN)
7. **Vive en VPS** separado del SaaS (o mismo VPS en puerto diferente)

**Flujo esperado:**
```
SaaS crea causa → Webhook a RDD → RDD crea Sheets row → Usuario chatea con RDD
→ RDD sube comprobantes a Drive → RDD actualiza Sheets → Dashboard se actualiza automáticamente
```

---

## 🏛️ Arquitectura de Sistema

### Flujo de Datos

```
┌─────────────────────────────────────────────────────────────────┐
│                         SaaS (legal-journey-saas)                │
│                      (Puerto 3000 en VPS)                        │
│  - Crea causa nueva                                             │
│  - Asigna drive_folder_id (carpeta en Google Drive)             │
│  - Dispara webhook: POST /webhook/causa-nueva                   │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Webhook JSON:
                         │ {
                         │   "causa_id": "123e4567",
                         │   "cliente_id": "cli_001",
                         │   "cliente_nombre": "Empresa XYZ",
                         │   "drive_folder_id": "folder_abc123",
                         │   "demandado": "Juan Pérez"
                         │ }
                         ↓
┌─────────────────────────────────────────────────────────────────┐
│                     RDD Agent (Port 3001)                        │
│  - Escucha webhooks                                             │
│  - Chat API (conversación multi-turn)                           │
│  - Claude AI para interpretación                                │
│  - Google Sheets Sync                                           │
│  - Google Drive Sync                                            │
└────────────┬──────────────────────────────┬─────────────────────┘
             │                              │
             ↓                              ↓
    ┌────────────────────┐      ┌──────────────────────┐
    │  Google Sheets     │      │   Google Drive       │
    │ INGRESOS_CAUSAS    │      │  /[Cliente]/         │
    │ - REGISTRO         │      │  [DEMANDADO]/        │
    │ - DASHBOARD        │      │  comprobantes/       │
    │ - ANÁLISIS FIN.    │      │  - acuerdo_pago.pdf  │
    │ - LIQUIDACIÓN      │      │  - transfer_1.pdf    │
    │ - REPORTES         │      │  - pago_cuota_1.pdf  │
    └────────────────────┘      └──────────────────────┘
```

### Estructura de Carpetas del SaaS (Referencia)

```
GOOGLE_DRIVE_ROOT_FOLDER_ID
│
├─ [NombreCliente] (creada por: crearCarpetaCliente)
│  │
│  ├─ DOC_ADM/ (documentos administrativos)
│  │
│  └─ [DEMANDADO_NOMBRE] o [DEMANDADO_NOMBRE Y OTRO] (creada por: crearEstructuraCarpetas)
│     ├─ demanda.pdf
│     ├─ sentencia.pdf
│     └─ ... (documentos de etapa/sub-etapa)
│
└─ [Otro Cliente]/
   ├─ DOC_ADM/
   └─ [DEMANDADO_NOMBRE]/
```

**RDD utiliza:**
- `drive_folder_id` → ruta donde subir comprobantes (viene en webhook)
- Estructura existente → no crea carpetas nuevas, solo sube archivos

---

## 🗂️ Estructura del Repositorio RDD

```
rdd-asistente-rodado/
│
├─ .env                          # Secretos (NO commitear)
├─ .env.example                  # Plantilla de .env
├─ .gitignore
│
├─ package.json                  # Dependencias
├─ tsconfig.json                 # TypeScript config
│
├─ src/
│  ├─ index.ts                   # Entry point
│  │
│  ├─ api/
│  │  ├─ webhook.ts              # POST /webhook/causa-nueva
│  │  ├─ chat.ts                 # POST /api/chat, GET /api/chat/:id
│  │  └─ health.ts               # GET /health (monitoreo)
│  │
│  ├─ agent/
│  │  ├─ claude-agent.ts          # Lógica de Claude multi-turn
│  │  ├─ message-parser.ts        # Parsear intención de usuario
│  │  └─ action-executor.ts       # Ejecutar acciones (Sheets, Drive)
│  │
│  ├─ sheets/
│  │  ├─ client.ts                # Google Sheets API wrapper
│  │  ├─ sync.ts                  # Actualizar REGISTRO, DASHBOARD, etc.
│  │  └─ formulas.ts              # Cálculos (honorarios, gastos, neto)
│  │
│  ├─ drive/
│  │  ├─ client.ts                # Google Drive API wrapper
│  │  ├─ upload.ts                # Subir comprobantes
│  │  └─ folder-resolver.ts       # Obtener carpeta correcta
│  │
│  ├─ database/
│  │  ├─ conversation-store.ts    # Guardar historial de chat (SQLite, Postgres, o JSON)
│  │  └─ types.ts                 # Tipos de datos
│  │
│  ├─ types/
│  │  ├─ rdd.ts                   # Tipos RDD (Causa, Pago, Acuerdo, etc.)
│  │  ├─ sheets.ts                # Tipos de Sheets (REGISTRO row, etc.)
│  │  └─ drive.ts                 # Tipos de Drive
│  │
│  ├─ utils/
│  │  ├─ logger.ts                # Logging centralizado
│  │  ├─ validators.ts            # Validar datos
│  │  └─ formatters.ts            # Formatear moneda, fechas, etc.
│  │
│  └─ config/
│     ├─ env.ts                   # Validar variables de entorno
│     └─ constants.ts             # Constantes (porcentajes, etc.)
│
├─ tests/
│  ├─ unit/
│  │  ├─ agent.test.ts
│  │  ├─ sheets-sync.test.ts
│  │  └─ validators.test.ts
│  │
│  └─ integration/
│     ├─ webhook.test.ts
│     └─ chat-flow.test.ts
│
├─ docs/
│  ├─ ARCHITECTURE.md             # Detalle técnico
│  ├─ API.md                       # Endpoints y ejemplos
│  ├─ SETUP.md                     # Pasos iniciales
│  └─ TROUBLESHOOTING.md           # Problemas comunes
│
├─ deployment/
│  ├─ pm2.config.js               # PM2 config para VPS
│  ├─ Dockerfile                  # Si usas Docker
│  └─ docker-compose.yml
│
└─ README.md                      # Overview
```

---

## 🔧 Variables de Entorno (`.env`)

```bash
# ═══════════════════════════════════════════════════════════
# GENERAL
# ═══════════════════════════════════════════════════════════
NODE_ENV=production
PORT=3001
LOG_LEVEL=info

# ═══════════════════════════════════════════════════════════
# INTEGRACIONES SaaS
# ═══════════════════════════════════════════════════════════
SAAS_WEBHOOK_SECRET=tu_secret_aqui          # Para validar webhooks del SaaS
SAAS_API_URL=http://localhost:3000          # Si SaaS en mismo VPS

# ═══════════════════════════════════════════════════════════
# GOOGLE WORKSPACE
# ═══════════════════════════════════════════════════════════
GOOGLE_SERVICE_ACCOUNT_EMAIL=rdd@project.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_KEY_BASE64=<base64_encoded_json>  # O file path
GOOGLE_SHEETS_SPREADSHEET_ID=tu_sheet_id_aqui
GOOGLE_DRIVE_ROOT_FOLDER_ID=tu_root_folder_id_aqui

# ═══════════════════════════════════════════════════════════
# CLAUDE AI (Anthropic)
# ═══════════════════════════════════════════════════════════
ANTHROPIC_API_KEY=sk-ant-...

# ═══════════════════════════════════════════════════════════
# BASE DE DATOS (Conversaciones)
# ═══════════════════════════════════════════════════════════
DATABASE_URL=postgresql://user:pass@localhost:5432/rdd_db
# O si usas SQLite:
DATABASE_PATH=./data/rdd.db

# ═══════════════════════════════════════════════════════════
# MONITOREO (Opcional)
# ═══════════════════════════════════════════════════════════
SENTRY_DSN=https://...  # Para error tracking
```

---

## 📡 API Endpoints Principales

### 1. Webhook: Recibir Causa Nueva

```http
POST /webhook/causa-nueva
Content-Type: application/json
Authorization: Bearer <SAAS_WEBHOOK_SECRET>

{
  "causa_id": "123e4567-e89b-12d3-a456-426614174000",
  "cliente_id": "cli_001",
  "cliente_nombre": "Empresa XYZ Ltda.",
  "cliente_rut": "76123456-7",
  "drive_folder_id": "folder_abc123xyz",
  "demandado": "Juan Pérez González",
  "rit": "RIT-2024-001234",
  "tribunal": "Juzgado de Letras en lo Civil de Santiago"
}
```

**Respuesta (201 Created):**
```json
{
  "success": true,
  "causa_id": "123e4567-e89b-12d3-a456-426614174000",
  "sheets_row_id": "A42",
  "message": "Causa registrada. ¿Cuál es el resultado del juicio?"
}
```

---

### 2. Chat: Conversar con RDD

```http
POST /api/chat
Content-Type: application/json

{
  "causa_id": "123e4567-e89b-12d3-a456-426614174000",
  "user_id": "user_123",
  "message": "Tenemos acuerdo de $500,000 en 5 cuotas mensuales. Adjunto está el PDF del acuerdo."
}
```

**Respuesta (200 OK):**
```json
{
  "success": true,
  "causa_id": "123e4567-e89b-12d3-a456-426614174000",
  "response": "✅ Registrado: Acuerdo de $500,000 en 5 cuotas mensuales. Primera cuota vence en 30 días. Documento guardado en Drive.",
  "actions": [
    {
      "type": "sheets_update",
      "status": "completed",
      "details": "REGISTRO actualizado con tipo='Acuerdo', monto=$500,000"
    },
    {
      "type": "drive_upload",
      "status": "completed",
      "file_name": "acuerdo_pago_causa_123e4567.pdf",
      "folder_path": "/Empresa XYZ Ltda./JUAN PÉREZ/"
    },
    {
      "type": "dashboard_refresh",
      "status": "completed",
      "details": "DASHBOARD y ANÁLISIS FINANCIERO actualizados"
    }
  ]
}
```

---

### 3. Chat: Ver Historial

```http
GET /api/chat/:causa_id
```

**Respuesta:**
```json
{
  "causa_id": "123e4567-e89b-12d3-a456-426614174000",
  "messages": [
    {
      "timestamp": "2026-05-29T19:30:00Z",
      "sender": "rdd",
      "message": "Causa registrada. ¿Cuál es el resultado del juicio?",
      "type": "initial"
    },
    {
      "timestamp": "2026-05-29T19:45:00Z",
      "sender": "user",
      "message": "Tenemos acuerdo de $500,000 en 5 cuotas mensuales.",
      "type": "user_input"
    },
    {
      "timestamp": "2026-05-29T19:45:15Z",
      "sender": "rdd",
      "message": "✅ Registrado: Acuerdo de $500,000...",
      "type": "response"
    }
  ]
}
```

---

### 4. Health Check (Monitoreo)

```http
GET /health
```

**Respuesta:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "services": {
    "claude_api": "connected",
    "google_sheets": "connected",
    "google_drive": "connected",
    "webhook_listener": "listening"
  }
}
```

---

## 🤖 Flujo de Claude Agent

### Arquitectura Multi-Turn

```
Usuario envia mensaje
    ↓
[POST /api/chat] endpoint
    ↓
Cargar historial de conversación (conversation_store)
    ↓
Claude.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  system: "Eres RDD, asistente contable de causas...",
  messages: [
    { role: "user", content: "Tengo acuerdo de $500k" },
    { role: "assistant", content: "Entendido, registrando..." },
    // ... historial completo
    { role: "user", content: "Primera cuota pagada" }
  ]
})
    ↓
Claude responde con acción (interpretar intención)
    ↓
message_parser.ts identifica:
  - Tipo: "agreement" | "payment" | "expense" | "query"
  - Datos extraídos: monto, cuotas, fecha, etc.
    ↓
action_executor.ts ejecuta:
  1. sheets_sync.actualizarRegistro()
  2. drive.subirComprobante()
  3. sheets_sync.recalcularDashboard()
    ↓
Guardar mensaje en conversation_store
    ↓
Responder a usuario con confirmación
```

### Ejemplo: Parseo de Intención

```typescript
// message_parser.ts
const intent = {
  type: "agreement",           // Del contexto histórico
  action: "register",
  data: {
    monto: 500000,
    moneda: "CLP",
    cuotas: 5,
    frecuencia: "mensual",
    demandado: "Juan Pérez",    // Del contexto de causa
    estado: "pactado"
  },
  attachments: [
    {
      type: "pdf",
      name: "acuerdo_pago.pdf",
      size: 245000
    }
  ]
};
```

---

## 📊 Integración con Google Sheets

### Actualizar REGISTRO

Cuando RDD recibe datos, ejecuta:

```typescript
// sheets/sync.ts
await actualizarRegistro({
  causaId: "123e4567",
  clienteNombre: "Empresa XYZ",
  demandado: "Juan Pérez",
  tipoIngreso: "Acuerdo",        // Dropdown: Sentencia, Cobranza, Acuerdo
  montoTotal: 500000,
  porcentajeHonorarios: 20,       // % del monto
  gastos: 15000,                  // Suma de gastos desglosados
  cuotas: 5,
  montoMensual: 100000,
  estado: "Acogida",              // Dropdown: Acogida, Rechazada, Caducada, Incobrable
  causaPagada: "Parcial",
  notas: "Acuerdo registrado vía chat RDD"
});
```

**Fórmulas que se calculan automáticamente:**
```
Col L (Honorarios) = J (Monto) × K (%) = 500,000 × 20% = 100,000
Col M (Gastos) = SUMIF(...) = 15,000
Col N (Neto) = J - L - M = 500,000 - 100,000 - 15,000 = 385,000
```

### Recalcular DASHBOARD

```typescript
// sheets/sync.ts
await recalcularDashboard({
  causaId: "123e4567"  // Solo actualiza fila relevante
});
```

Sheets recalcula automáticamente:
- Totales de causas por estado
- Ingresos totales recuperados
- Honorarios del bufete
- Gastos totales
- Gráficos (Pie de distribución, Bar de ingresos)

---

## 📁 Integración con Google Drive

### Subir Comprobante

```typescript
// drive/upload.ts
await subirComprobante({
  causaId: "123e4567",
  driveFolderId: "folder_abc123",    // Del webhook
  archivo: pdfBuffer,                 // Buffer del PDF
  tipoComprobante: "acuerdo_pago",    // Tipo de documento
  nombreArchivo: "acuerdo_pago_2026-05-29.pdf"
});
```

**Estructura final en Drive:**
```
/Empresa XYZ Ltda./JUAN PÉREZ/
├─ acuerdo_pago_2026-05-29.pdf
├─ comprobante_transferencia_1.pdf
├─ comprobante_cuota_1_pago.pdf
└─ ... (más comprobantes)
```

---

## 💾 Almacenamiento de Conversaciones

RDD mantiene historial persistente de chats para contexto multi-turn.

### Opción 1: SQLite (Simple, local)

```sql
-- rdd.db
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  causa_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (causa_id) REFERENCES causas_tracked(id)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);
```

### Opción 2: PostgreSQL (Robusto, escalable)

```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  causa_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  role TEXT CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_conversations_causa ON conversations(causa_id);
```

---

## 🚀 Plan de Implementación (5 Fases)

### Fase 1: Infraestructura Base (30 minutos)

**Objetivos:**
- [ ] Crear repo nuevo: `rdd-asistente-rodado`
- [ ] Configurar Node.js + TypeScript
- [ ] Setup variables de entorno
- [ ] PM2 config local

**Archivos:**
- `package.json`
- `tsconfig.json`
- `.env.example`
- `src/index.ts` (Express server)

**Verificación:**
```bash
npm run dev
# Server listening on port 3001 ✓
```

---

### Fase 2: Webhook Listener (1 hora)

**Objetivos:**
- [ ] Implementar `POST /webhook/causa-nueva`
- [ ] Validar webhook signature
- [ ] Crear row en REGISTRO de Sheets
- [ ] Guardar metadata en database

**Archivos:**
- `src/api/webhook.ts`
- `src/types/rdd.ts` (tipos básicos)
- `src/sheets/client.ts` (Google Sheets wrapper)

**Verificación:**
```bash
# Test webhook:
curl -X POST http://localhost:3001/webhook/causa-nueva \
  -H "Authorization: Bearer test_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "causa_id": "test-123",
    "cliente_nombre": "Test Client",
    "drive_folder_id": "folder_xyz"
  }'
# Response: { "success": true, "causa_id": "test-123" } ✓
```

---

### Fase 3: Chat API + Claude Agent (2 horas)

**Objetivos:**
- [ ] Implementar `POST /api/chat`
- [ ] Integrar Claude API (multi-turn)
- [ ] Parser de intenciones
- [ ] Guardar conversaciones

**Archivos:**
- `src/api/chat.ts`
- `src/agent/claude-agent.ts`
- `src/agent/message-parser.ts`
- `src/database/conversation-store.ts`

**Verificación:**
```bash
# Test chat:
curl -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "causa_id": "test-123",
    "user_id": "user_456",
    "message": "Tenemos acuerdo de $500,000"
  }'
# Response: { "success": true, "response": "✅ Registrado..." } ✓
```

---

### Fase 4: Google Sheets Sync (1.5 horas)

**Objetivos:**
- [ ] Actualizar REGISTRO con datos
- [ ] Calcular honorarios, gastos, neto
- [ ] Recalcular DASHBOARD
- [ ] Recalcular ANÁLISIS FINANCIERO

**Archivos:**
- `src/sheets/sync.ts`
- `src/sheets/formulas.ts`

**Verificación:**
```bash
# Verificar en Google Sheets:
# - REGISTRO tiene nueva row
# - DASHBOARD muestra actualización
# - Gráficos se recalcularon ✓
```

---

### Fase 5: Google Drive Integration (1 hora)

**Objetivos:**
- [ ] Subir comprobantes a Drive
- [ ] Validar tipos de archivo
- [ ] Generar URLs shareable
- [ ] Vincular en Sheets

**Archivos:**
- `src/drive/client.ts`
- `src/drive/upload.ts`
- `src/drive/folder-resolver.ts`

**Verificación:**
```bash
# Verificar en Google Drive:
# - Archivo subido a /[Cliente]/[DEMANDADO]/
# - URL accessible en Sheets ✓
```

---

## 🔐 Seguridad

### Validación de Webhooks

```typescript
// src/api/webhook.ts
import crypto from 'crypto';

function validateWebhookSignature(req: Request) {
  const signature = req.headers.get('x-webhook-signature');
  const payload = req.body;
  
  const computed = crypto
    .createHmac('sha256', process.env.SAAS_WEBHOOK_SECRET!)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  if (signature !== computed) {
    throw new Error('Invalid webhook signature');
  }
}
```

### Autenticación Google

```typescript
// src/config/env.ts
const serviceAccountKey = JSON.parse(
  Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64!, 'base64').toString()
);

// RDD se autentica como: rdd@project.iam.gserviceaccount.com
// Permisos:
// - Editor en Google Sheets (INGRESOS_CAUSAS)
// - Editor en Google Drive (root folder)
```

---

## 📝 Ejemplos de Flujos Reales

### Flujo 1: Registrar Acuerdo de Pago

```
Usuario: "Acuerdo de $500,000 en 5 cuotas"
   ↓
[Claude interpreta]
   ↓
RDD: "Entendido. Creando estructura de pago..."
   ↓
[Acciones automáticas]
  1. REGISTRO: nueva row con tipo="Acuerdo", monto=$500,000
  2. DASHBOARD: suma total ingresos ahora = $X,XXX,XXX
  3. ANÁLISIS FIN.: Acuerdo cuenta como 1/N en distribución por tipo
   ↓
RDD: "✅ Registrado: Acuerdo de $500,000 en 5 cuotas mensuales. ¿Tienes el PDF del acuerdo?"

Usuario: [sube PDF]
   ↓
[Claude detecta attachment]
   ↓
RDD: "Guardando en Drive..."
   ↓
[Acciones]
  1. DRIVE: sube PDF a /[Cliente]/[DEMANDADO]/acuerdo_pago_2026-05-29.pdf
  2. REGISTRO: agrega link a comprobante
   ↓
RDD: "✅ Documento guardado. ¿Cuándo vence la primera cuota?"
```

### Flujo 2: Registrar Pago Recibido

```
Usuario: "Recibí primer pago de $100,000. Adjunto transferencia."
   ↓
[Claude interpreta como: payment]
   ↓
[Acciones]
  1. REGISTRO: nueva fila TRANSFERENCIAS con monto=$100,000, fecha=hoy
  2. DASHBOARD: saldo pendiente ahora = $400,000
  3. LIQUIDACIÓN: pago empresa + pago cliente se recalculan
   ↓
RDD: "✅ Registrado: Pago de $100,000. Pendiente: $400,000 en 4 cuotas. ¿Siguiente cuota?"

Usuario: "Próxima vence en 30 días"
   ↓
RDD: "[Guarda contexto] Entendido. Te recordaré el 29 de junio."
```

---

## 🛠️ Comandos Útiles (VPS)

```bash
# Instalar dependencias
cd /rdd-asistente-rodado
npm install

# Compilar TypeScript
npm run build

# Ejecutar en desarrollo
npm run dev

# Ejecutar con PM2 (producción)
npm run pm2:start
npm run pm2:logs
pm2 restart rdd
npm run pm2:stop

# Ver estado
pm2 status
pm2 monit

# Tests
npm run test
npm run test:integration
```

---

## 📖 Documentación Adicional

Cuando crees el repo, incluye:

- **ARCHITECTURE.md** — Diagramas de secuencia, decisiones técnicas
- **API.md** — Referencia completa de endpoints + ejemplos cURL
- **SETUP.md** — Pasos exactos para setupear en VPS
- **TROUBLESHOOTING.md** — Problemas comunes + soluciones

---

## ✅ Checklist de Lanzamiento

Antes de ir a producción:

- [ ] Todas las variables de entorno configuradas
- [ ] Google Sheets INGRESOS_CAUSAS creado + compartido
- [ ] Google Drive root folder ID confirmado
- [ ] Claude API key activa + con créditos
- [ ] Webhook secret del SaaS configurado
- [ ] Database (SQLite o Postgres) funcional
- [ ] PM2 configurado para autostart en reboot
- [ ] Logs centralizados (Sentry o similar)
- [ ] Tests pasan: `npm run test`
- [ ] Health check responde: `curl http://localhost:3001/health`
- [ ] Webhook testeable desde SaaS

---

## 📞 Resumen de Pasos Iniciales

1. **Crea repo:** `git init rdd-asistente-rodado`
2. **Setup:** `npm init -y && npm install express anthropic google-auth-library`
3. **Estructura:** Copia la estructura de carpetas (src/, tests/, etc.)
4. **Variables:** Copia `.env.example` y llena tus secretos
5. **Fase 1:** Implementa servidor Express + webhook listener
6. **Test:** `npm run dev && curl http://localhost:3001/health`
7. **Iterate:** Fase 2 (webhook) → 3 (chat) → 4 (sheets) → 5 (drive)

---

**FIN DE GUÍA**  
Próximo paso: Crear repo nuevo y comenzar Fase 1.
