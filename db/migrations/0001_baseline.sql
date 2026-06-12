-- ============================================================================
-- 0001_baseline.sql — Schema completo de RDD (baseline al 2026-06-12)
-- ============================================================================
-- Reconstruido desde las fuentes documentadas del repo:
--   - src/database/schema.ts (interfaz Conversation, Fases 5.3 + 9.1 + 9.2)
--   - docs/FASE_6_1_DDL.sql (acuerdos, cuotas, registros)
--   - scripts/add-pending-action-column.ts (Fase 9.2)
--   - scripts/migrate-case-states.ts (Fase 9.1: case_state activa|cerrada)
--
-- Idempotente (IF NOT EXISTS): seguro de ejecutar sobre un proyecto nuevo o
-- uno existente. Aplicar en Supabase SQL Editor y verificar al final.
-- ============================================================================

-- ── Control de migraciones ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- ── conversations: un hilo por causa legal ──────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  causa_id text UNIQUE NOT NULL,
  -- Datos del webhook causa-nueva
  cliente_nombre text,
  cliente_rut text,
  demandado text,
  tribunal text,
  rit text,
  etapa text,
  monto_demanda numeric,
  -- Estado canónico del caso (contrato Fase 9.1)
  case_state text NOT NULL DEFAULT 'activa'
    CHECK (case_state IN ('activa', 'cerrada')),
  motivo_cierre text
    CHECK (motivo_cierre IN ('pago_total', 'desistimiento', 'caducada') OR motivo_cierre IS NULL),
  sub_etapa_saas text,
  -- Acción proactiva pendiente del agente (Fase 9.2)
  pending_action text
    CHECK (pending_action = 'ask_acuerdo_terms' OR pending_action IS NULL),
  -- Acumuladores financieros
  ingreso_honorarios numeric NOT NULL DEFAULT 0,
  pagos_pendientes numeric NOT NULL DEFAULT 0,
  acuerdo_monto numeric,
  acuerdo_cuotas int,
  -- Datos del abogado
  abogado_nombre text,
  abogado_email text,
  -- Integración Drive
  drive_folder_id text,
  -- Sistema
  message_count int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- ── messages: turnos de conversación ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL CHECK (length(content) > 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── audit_log: trail inmutable de cambios ───────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('conversation', 'message')),
  entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'CLOSE')),
  user_id text NOT NULL,
  changes jsonb NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── acuerdos: acuerdos de pago negociados (Fase 6.1) ────────────────────────
CREATE TABLE IF NOT EXISTS acuerdos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  monto_total numeric NOT NULL,
  cuotas_total int NOT NULL,
  monto_por_cuota numeric NOT NULL,
  porcentaje_honorarios numeric NOT NULL DEFAULT 0,
  fecha_primer_pago date NOT NULL,
  estado text NOT NULL DEFAULT 'activo'
    CHECK (estado IN ('activo', 'completado', 'incumplido')),
  created_at timestamptz DEFAULT now()
);

-- ── cuotas: cada cuota de un acuerdo (Fase 6.1) ─────────────────────────────
CREATE TABLE IF NOT EXISTS cuotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  acuerdo_id uuid NOT NULL REFERENCES acuerdos(id) ON DELETE CASCADE,
  numero int NOT NULL,
  monto numeric NOT NULL,
  fecha_vencimiento date NOT NULL,
  fecha_pago date,                   -- NULL = no pagada
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'pagada', 'vencida', 'pagada_con_retraso')),
  created_at timestamptz DEFAULT now()
);

-- ── registros: ingresos/gastos sueltos (Fase 6.1) ───────────────────────────
CREATE TABLE IF NOT EXISTS registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  tipo text NOT NULL
    CHECK (tipo IN ('cobranza', 'sentencia', 'gasto', 'honorarios')),
  monto numeric NOT NULL,
  fecha date NOT NULL,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- ── Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversations_causa_id ON conversations(causa_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conversations_closed_at ON conversations(closed_at);
CREATE INDEX IF NOT EXISTS idx_conversations_case_state ON conversations(case_state);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_id ON audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_type_created ON audit_log(entity_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON audit_log(user_id);

CREATE INDEX IF NOT EXISTS idx_acuerdos_conversation_id ON acuerdos(conversation_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_acuerdo_id ON cuotas(acuerdo_id);
CREATE INDEX IF NOT EXISTS idx_cuotas_fecha_vencimiento ON cuotas(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_cuotas_estado ON cuotas(estado);
CREATE INDEX IF NOT EXISTS idx_registros_conversation_id ON registros(conversation_id);
CREATE INDEX IF NOT EXISTS idx_registros_tipo ON registros(tipo);

-- ── Permisos ────────────────────────────────────────────────────────────────
GRANT ALL ON public.conversations TO service_role;
GRANT ALL ON public.messages TO service_role;
GRANT ALL ON public.audit_log TO service_role;
GRANT ALL ON public.acuerdos TO service_role;
GRANT ALL ON public.cuotas TO service_role;
GRANT ALL ON public.registros TO service_role;
GRANT ALL ON public.schema_migrations TO service_role;

-- ── Registrar migración ─────────────────────────────────────────────────────
INSERT INTO schema_migrations (version) VALUES ('0001_baseline')
ON CONFLICT (version) DO NOTHING;

-- ── Verificación (debe devolver 7 filas) ────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('conversations', 'messages', 'audit_log', 'acuerdos',
                     'cuotas', 'registros', 'schema_migrations')
ORDER BY table_name;
