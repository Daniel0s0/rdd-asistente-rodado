# Contrato de Estados y Webhooks: SaaS → RDD

> Documento de integración. Define los estados del SaaS y el payload exacto de cada webhook.
> Versión: 1.0 | Fecha: 2026-06-01

---

## 1. Modelo de Estados (SaaS)

### Etapa Actual (nivel 1)

| Valor en SaaS | Descripción |
|---------------|-------------|
| `Litigacion` | Causa en tramitación judicial activa |
| `Cobranza` | Causa en cobro forzado (post-sentencia sin pago voluntario) |
| `Cierre` | Causa finalizada por algún motivo |

### Sub-etapa (nivel 2)

#### Etapa: Litigacion

| Sub-etapa | Descripción | ¿Genera ingreso en RDD? |
|-----------|-------------|------------------------|
| `Tramitacion` | En proceso, sin resolución aún | No |
| `Acuerdo` | Se pactó acuerdo con cuotas | Sí (cuotas) |
| `Sentencia` | Resolución judicial obtenida | Sí (transferencia) |

#### Etapa: Cobranza

| Sub-etapa | Descripción | ¿Genera ingreso en RDD? |
|-----------|-------------|------------------------|
| `Ingreso` | Inicio de cobranza, sin medidas aún | No |
| `Acuerdo` | Acuerdo de pago pactado en cobranza | Sí (cuotas) |
| `Embargo - Cuentas` | Embargo bancario ejecutado | Sí |
| `Embargo - Vehículo` | Embargo de vehículo ejecutado | Sí |
| `Embargo - Inmueble` | Embargo de inmueble ejecutado | Sí |
| `Retencion Impuesto` | Retención de devolución TGR | Sí |
| `Consignacion` | Pago voluntario del deudor en tribunal | Sí |

#### Etapa: Cierre

| Sub-etapa | RDD mantiene activa | motivo_cierre en RDD |
|-----------|--------------------|--------------------|
| `Acuerdo` | **Sí** (espera pagos) | — |
| `Pago` | No | `pago_total` |
| `Desistimiento` | No | `desistimiento` |
| `Caducada` | No | `caducada` |

---

## 2. Webhooks

### Webhook 1: Causa Nueva
**Endpoint:** `POST /webhook/causa-nueva`

```json
{
  "causa_id": "2024-00123",
  "cliente_nombre": "Juan García López",
  "cliente_rut": "12.345.678-9",
  "demandado": "Empresa S.A.",
  "tribunal": "Juzgado de Letras del Trabajo N°5 Santiago",
  "rit": "O-1234-2024",
  "etapa": "Litigacion",
  "sub_etapa": "Tramitacion"
}
```

### Webhook 2: Cambio de Etapa
**Endpoint:** `POST /webhook/caso-etapa`

```json
{
  "causa_id": "2024-00123",
  "etapa_nueva": "Cobranza",
  "sub_etapa_nueva": "Ingreso",
  "etapa_anterior": "Litigacion",
  "sub_etapa_anterior": "Sentencia",
  "timestamp": "2026-06-01T14:30:00Z"
}
```

### Webhook 3: Cierre de Causa
**Endpoint:** `POST /webhook/caso-cierre`

```json
{
  "causa_id": "2024-00123",
  "sub_etapa": "Pago",
  "fecha_cierre": "2026-06-01",
  "timestamp": "2026-06-01T14:30:00Z"
}
```

Valores posibles de `sub_etapa`: `Acuerdo` | `Pago` | `Desistimiento` | `Caducada`

### Webhook 4: Actualización de Datos
**Endpoint:** `POST /webhook/caso-modificacion`

```json
{
  "causa_id": "2024-00123",
  "rit": "O-1234-2024",
  "tribunal": "Juzgado de Letras del Trabajo N°5 Santiago"
}
```

---

## 3. Mapping Completo SaaS → RDD

| SaaS Etapa | SaaS Sub-etapa | RDD case_state | RDD etapa | RDD motivo_cierre | Acción Agente |
|-----------|----------------|----------------|-----------|-------------------|--------------------|
| Litigacion | Tramitacion | `activa` | `litigacion` | null | — |
| Litigacion | Acuerdo | `activa` | `litigacion` | null | Solicitar términos |
| Litigacion | Sentencia | `activa` | `litigacion` | null | Solicitar monto |
| Cobranza | * | `activa` | `cobranza` | null | Según tipo |
| Cierre | Acuerdo | `activa` | (mantiene) | null | Solicitar términos |
| Cierre | Pago | `cerrada` | (mantiene) | `pago_total` | — |
| Cierre | Desistimiento | `cerrada` | (mantiene) | `desistimiento` | — |
| Cierre | Caducada | `cerrada` | (mantiene) | `caducada` | — |

---

## 4. Autenticación

Header requerido en todos los webhooks:
```
x-webhook-signature: HMAC-SHA256(body_json, SAAS_WEBHOOK_SECRET)
```
