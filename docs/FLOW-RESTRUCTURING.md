# RDD Flow Restructuring: Carpetas Independientes

**Fecha:** 2026-05-30  
**Razón:** Separación de contabilidad (SaaS) vs tramitación (RDD)  
**Impacto:** Webhook, registro en Sheets, estructura de Drive

---

## Flujo ANTERIOR (Shared Folder)

### Arquitectura

```
SaaS System (Causa Management)
    ↓ 
    └─> Crea causa + crea carpeta en Drive compartida
        └─> /Legal Journey SaaS/[Causa_ID]/
    ↓
SaaS Webhook: POST /webhook/causa-nueva
    ↓
RDD: 
    1. Valida firma HMAC
    2. Registra en REGISTRO tab (Sheets)
    3. Crea conversación en SQLite
    ↓
RDD Agent:
    1. Lee documentos de carpeta SaaS: /Legal Journey SaaS/[Causa_ID]/
    2. Procesa consultas del usuario
    3. Retorna documentos de la misma carpeta

SHEETS REGISTRO (SaaS Compartido):
    | Causa | Etapa | Demandado | Documentos | Notas |
    | 2024-001 | Tramitación | Juan Pérez | /Legal Journey/... | ... |

DRIVE STRUCTURE:
    /Legal Journey SaaS/
        ├── Casos/
        │   ├── 2024-001/
        │   ├── 2024-002/
```

### Problema con este flujo

- **Contabilidad y tramitación mezcladas** en el mismo Drive/Sheets
- **SaaS es dueño** de la carpeta y documentos
- **RDD depende** de estructura del SaaS (si cambia, RDD se rompe)
- **No hay separación** entre "estado del caso en SaaS" vs "documentos tramitación en RDD"

---

## Flujo NUEVO (Independent Folder)

### Arquitectura

```
SaaS System (Causa Management - FUENTE DE VERDAD)
    ↓
    └─> Crea causa (registro de contabilidad, partes)
        └─> Stores in: SaaS Database + SaaS Sheets
    ↓
SaaS Webhook: POST /webhook/causa-nueva
    ├─ Payload: { causa_id, demandado, etapa, partes, ... }
    ↓
RDD: 
    1. Valida firma HMAC
    2. Crea carpeta en Drive RDD: /Rodado/[Causa_ID]/
    3. Registra en REGISTRO tab (RDD Sheets) ← CAMBIO
    4. Crea conversación en SQLite
    ↓
RDD Agent:
    1. Espera documentos del usuario (vía email/webhook/upload)
    2. Organiza en: /Rodado/[Causa_ID]/[Etapa]/[Documento]
    3. Registra en RDD Sheets
    4. Responde consultas desde RDD Drive
    ↓
Usuario pregunta: "Dame comprobante de pago causa 2024-001"
    ↓
RDD Agent:
    1. Busca en /Rodado/2024-001/ por "comprobante pago"
    2. Retorna link de Drive RDD
    3. (SaaS Sheets NO se actualiza - RDD mantiene su propio registro)

SHEETS REGISTRO (RDD Independiente):
    | Causa_ID | Demandado | Etapa_Actual | Documentos_RDD | Fecha_Actualización |
    | 2024-001 | Juan Pérez | Tramitación | 3 archivos | 2026-05-30 |

DRIVE STRUCTURE:
    /Rodado/ (daniel@rdd.cl Drive)
        ├── 2024-001/
        │   ├── Por-Resolver/
        │   │   ├── demandados.pdf
        │   │   ├── escritura-inicial.pdf
        │   └── Resueltos/
        │       ├── comprobante-pago.pdf
        ├── 2024-002/
        │   └── Por-Resolver/
```

### Ventajas de este flujo

- ✅ **SaaS = contabilidad**, RDD = **tramitación** (separado)
- ✅ **RDD es autónomo** - su carpeta no depende del SaaS
- ✅ **Usuario controla documentos** - los envía a RDD
- ✅ **Búsqueda rápida** - RDD mantiene índice local de documentos
- ✅ **Escalable** - si SaaS cambia, RDD sigue funcionando

---

## Cambios Específicos

### 1. Webhook Payload (SaaS → RDD)

**NO CAMBIA el webhook**, pero SU INTERPRETACIÓN cambia:

```typescript
// SaaS envía (mismo formato):
{
  causa_id: "2024-001",
  demandado: "Juan Pérez",
  etapa: "Tramitación",
  demandados: [...],
  partes: [...]
}

// RDD ANTES interpretaba como:
// "Obtener documentos de /Legal Journey SaaS/2024-001/"

// RDD AHORA interpreta como:
// 1. Crear /Rodado/2024-001/ en Drive
// 2. Crear entrada en REGISTRO (RDD Sheets)
// 3. Esperar que usuario envíe documentos
```

### 2. Registro en Sheets

**ANTES (SaaS):**
```
| Causa | Demandado | Etapa | Documentos | Abogado |
| 2024-001 | Juan Pérez | Tramitación | /Legal Journey/2024-001 | Ana |
```

**AHORA (RDD - Independiente):**
```
| Causa_ID | Demandado | Etapa_Actual | Documentos_En_RDD | Fecha_Creacion | Usuario_RDD |
| 2024-001 | Juan Pérez | Tramitación | [] (vacío inicialmente) | 2026-05-30 | daniel@rdd.cl |
| 2024-001 | Juan Pérez | Resueltos | [comprobante-pago.pdf] | 2026-06-01 | daniel@rdd.cl |
```

**Notas:**
- RDD Sheets es **APPEND-ONLY** (como antes)
- **Cada fila = momento en que cambió algo**
- Permite ver historial completo de cambios de etapa

### 3. Estructura de Drive

**ANTES:**
```
/Legal Journey SaaS/
├── Casos/
│   ├── 2024-001/
│   │   ├── demandados.pdf (creado por SaaS)
│   │   ├── escritura.pdf (creado por SaaS)
```

**AHORA:**
```
/Rodado/ (daniel@rdd.cl)
├── 2024-001/
│   ├── Por-Resolver/
│   │   ├── demandados.pdf (enviado por usuario)
│   │   ├── escritura-inicial.pdf (enviado por usuario)
│   │   ├── pruebas-periciales.pdf
│   └── Resueltos/
│       ├── sentencia.pdf
│       ├── comprobante-pago.pdf
├── 2024-002/
│   ├── Por-Resolver/
│   │   └── demandados.pdf
```

---

## Workflow Post-Cambio (Phase 4 Implementation)

### Para cada nueva Causa

```
1. SaaS webhook #1: POST /webhook/causa-nueva
   ├─ Payload: { causa_id, demandado, etapa, ... }
   
2. RDD procesa webhook:
   ├─ Crea carpeta: /Rodado/[Causa_ID]/
   ├─ Crea subcarpetas: Por-Resolver/, Resueltos/
   ├─ Registra en RDD Sheets: REGISTRO tab (status: Tramitación)
   ├─ Crea conversación SQLite
   └─ Responde 200 OK al SaaS

3. SaaS webhook #2: POST /webhook/caso-modificacion (RIT + Tribunal)
   ├─ Payload: { causa_id, rit, tribunal, cambios, ... }
   ├─ RDD actualiza conversación SQLite
   └─ Registra en RDD Sheets (nueva fila con nuevo estado)

4. Usuario y RDD se comunican por WhatsApp:
   ├─ Usuario: "Dame estado de causa 2024-001"
   ├─ RDD: Busca en SQLite + Drive → retorna info + documentos
   
5. Usuario envía documentos POR WhatsApp:
   ├─ Usuario: "Te envío cierre de 2024-001" (envía PDF)
   ├─ RDD Agent recibe PDF vía WhatsApp
   ├─ En contexto de conversación, identifica: Causa_ID + Tipo_Doc (Cierre/Pago)
   ├─ Guarda en: /Rodado/[Causa_ID]/Resueltos/[tipo]-[fecha].pdf
   └─ Actualiza RDD Sheets
   
6. SaaS webhook #3: POST /webhook/caso-cierre
   ├─ Payload: { causa_id, fecha_cierre, motivo, ... }
   ├─ RDD cambia status a: Resueltos
   ├─ Registra en RDD Sheets
   └─ Responde 200 OK
   
7. Usuario pregunta a RDD:
   ├─ "¿Qué pagos tengo en 2024-001?"
   ├─ RDD busca en /Rodado/2024-001/comprobantes*
   ├─ Retorna: Links de Drive + resumen
```

### Flujo Conversacional WhatsApp

```
Daniel: ¿Estado de 2024-001?
RDD: Causa Juan Pérez vs Pedro López
     RIT: 23-12345-6
     Tribunal: Juzgado de Letras
     Status: Tramitación
     Documentos: demandados.pdf, escritura.pdf
     
Daniel: Me envías ese escritura
RDD: [Envía PDF desde Drive]

Daniel: Te envío cierre
RDD: [Recibe PDF]
     ¿Confirmo que guardé en Resueltos/cierre-2024-001.pdf?

Daniel: Sí, y también pago
RDD: [Recibe PDF de comprobante]
     ¿Es comprobante de pago? Guardado en /Rodado/2024-001/Resueltos/pago-20260530.pdf
```

---

## Cambios en Código (Phase 4)

### webhook.ts (Actualización necesaria)

**HANDLER #1: causa-nueva**
```typescript
POST /webhook/causa-nueva
  1. Valida firma HMAC
  2. Crea carpeta: /Rodado/[Causa_ID]/
  3. Crea subcarpetas: Por-Resolver/, Resueltos/
  4. Registra en RDD Sheets (status: Tramitación)
  5. Crea conversación SQLite
  6. Responde 200 OK
```

**HANDLER #2: caso-modificacion (RIT + Tribunal)**
```typescript
POST /webhook/caso-modificacion
  1. Valida firma
  2. Actualiza conversación SQLite
  3. Registra en RDD Sheets (nueva fila con info actualizada)
  4. Responde 200 OK
```

**HANDLER #3: caso-cierre**
```typescript
POST /webhook/caso-cierre
  1. Valida firma
  2. Cambia status en SQLite: Tramitación → Resueltos
  3. Registra en RDD Sheets (status: Resueltos)
  4. Responde 200 OK
```

### Nuevos Módulos (Phase 4)

```
src/drive/
├── drive-organizer.ts    → Crear/navegar carpetas en /Rodado/
├── document-manager.ts   → Guardar PDFs recibidos vía WhatsApp
├── document-search.ts    → Buscar documentos por causa/etapa
└── drive-init.ts         → Setup inicial de carpetas para causa nueva

src/agent/
├── document-handler.ts   → Procesar PDFs de WhatsApp en conversación
├── intent-classifier.ts  → "¿Es cierre?", "¿Es comprobante pago?"
```

### WhatsApp Integration (Phase 4+, pero afecta agent)

```typescript
// Claude Agent recibe mensaje WhatsApp con PDF adjunto
// En contexto de conversación [causa_id, user_id]

// Ejemplo:
agent.chat(userId, causaId, {
  text: "Te envío cierre",
  attachments: [
    { type: "pdf", filename: "cierre.pdf", url: "..." }
  ]
})

// Agent debe:
// 1. Descargar PDF desde WhatsApp
// 2. Guardar en: /Rodado/[causa_id]/Resueltos/cierre-[date].pdf
// 3. Actualizar SQLite
// 4. Actualizar RDD Sheets
// 5. Responder: "¿Confirmo que guardé en Resueltos/cierre-...?"
```

---

## Decisiones Resueltas (Phase 4)

- ✅ **D22: Mecanismo de recepción de documentos** — **WhatsApp** (usuario envía PDFs en conversación)
- ✅ **D23: Clasificación automática de etapa** — **Webhook #3 desde SaaS** determina Resueltos; usuario indica en chat para Por-Resolver
- ✅ **D24: Metadatos de documentos** — **Nombre archivo = metadata** (cierre-[fecha].pdf, pago-[fecha].pdf)
- ✅ **D25: Historial de cambios de etapa** — **RDD Sheets (append-only)** + **webhooks #2 y #3** desde SaaS

---

## Summary Table

| Aspecto | Antes (Shared) | Ahora (Independent) |
|--------|---|---|
| **Carpeta Drive** | /Legal Journey SaaS/ | /Rodado/ (daniel@rdd.cl) |
| **Dueño de docs** | SaaS | Usuario (daniel) |
| **Sheets REGISTRO** | SaaS Sheets | RDD Sheets (nueva) |
| **Fuente de causa** | SaaS | SaaS (pero RDD mantiene copia) |
| **Webhook endpoint** | Mismo | Mismo |
| **Lógica post-webhook** | Lee docs del SaaS | Crea carpetas, espera docs de usuario |
| **Búsqueda de docs** | "¿Dónde está en SaaS?" | "¿Dónde está en /Rodado/?" |
| **Escalabilidad** | Depende de SaaS | Autónomo |

---

## Phase 4 Scope (Drive Integration)

Con esta claridad, Phase 4 debe:

1. **Update webhook handlers (3 handlers)**
   - `POST /webhook/causa-nueva` — Crear carpetas en /Rodado/
   - `POST /webhook/caso-modificacion` — Actualizar RIT/tribunal en conversación
   - `POST /webhook/caso-cierre` — Cambiar status a Resueltos

2. **Create drive-organizer.ts** 
   - `createCaseFolder(causaId)` — /Rodado/[Causa_ID]/ + subcarpetas
   - `saveDocument(causaId, etapa, pdf, filename)` — Guardar en carpeta correcta
   - `searchByCase(causaId)` — Listar documentos de una causa

3. **Create document-handler.ts** (para agent)
   - Procesar PDFs adjuntos en chat WhatsApp
   - Detectar tipo: "cierre", "pago", "otro"
   - Guardar en carpeta correcta + actualizar Sheets

4. **Update agent.ts**
   - Manejar attachments (PDFs) en conversación
   - Clasificar tipo de documento
   - Confirmar con usuario antes de guardar

5. **Update RDD Sheets schema**
   - Agregar columna: Documentos_En_RDD (lista de archivos)
   - Append-only para cada cambio

6. **Test integration**
   - Webhook → carpeta creada ✅
   - Agent recibe PDF → guardado en Drive ✅
   - Búsqueda por causa → retorna documentos ✅

---

## Notas de Implementación

- **Spreadsheet ID:** Necesitas crear un Google Sheet nuevo para "RDD REGISTRO" (no el del SaaS)
- **Drive Folder:** Ya verificado: /Rodado/ (1RPyU5KCqpCQeFIdMlBc-HDXQbzyH6hGe)
- **WhatsApp Integration:** Phase 5+ (por ahora agent.ts puede recibir attachments genéricos)
- **3 Webhooks:** SaaS ya debería estar enviando estos, necesitamos verificar en Phase 4
