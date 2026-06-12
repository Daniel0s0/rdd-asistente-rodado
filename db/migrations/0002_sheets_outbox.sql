-- ============================================================================
-- 0002_sheets_outbox.sql — Outbox para sincronización resiliente con Sheets
-- ============================================================================
-- Etapa 4.1 (production readiness): si Google Sheets falla, la operación queda
-- encolada aquí y un worker la reintenta. El webhook/chat nunca pierde un
-- registro de ingreso por culpa de Sheets.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sheets_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL CHECK (operation IN ('append_registro', 'update_registro')),
  causa_id text NOT NULL,
  payload jsonb NOT NULL,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'procesado', 'error')),
  intentos int NOT NULL DEFAULT 0,
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_sheets_outbox_estado ON sheets_outbox(estado);
CREATE INDEX IF NOT EXISTS idx_sheets_outbox_created_at ON sheets_outbox(created_at);

GRANT ALL ON public.sheets_outbox TO service_role;

INSERT INTO schema_migrations (version) VALUES ('0002_sheets_outbox')
ON CONFLICT (version) DO NOTHING;
