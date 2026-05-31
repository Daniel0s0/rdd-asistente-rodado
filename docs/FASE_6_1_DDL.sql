-- ============================================================================
-- FASE 6.1 — Modelo de Datos en Supabase
-- ============================================================================
-- Ejecuta esto en Supabase SQL Editor: https://supabase.com/dashboard
-- Proyecto: rdd-asistente-rodado
-- ============================================================================

-- Tabla: acuerdos
-- Registra acuerdos de pago negociados (p.ej., 6 cuotas de $300k cada una)
CREATE TABLE acuerdos (
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

-- Tabla: cuotas
-- Cada cuota de un acuerdo, con fecha de vencimiento y fecha de pago (NULL = no pagada)
CREATE TABLE cuotas (
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

-- Tabla: registros
-- Registros de cobranza, sentencia, gasto, honorarios (sin estructura de cuotas)
CREATE TABLE registros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  tipo text NOT NULL
    CHECK (tipo IN ('cobranza', 'sentencia', 'gasto', 'honorarios')),
  monto numeric NOT NULL,
  fecha date NOT NULL,
  notas text,
  created_at timestamptz DEFAULT now()
);

-- GRANTs: Permitir que service_role escriba en las nuevas tablas
GRANT ALL ON public.acuerdos TO service_role;
GRANT ALL ON public.cuotas TO service_role;
GRANT ALL ON public.registros TO service_role;

-- Verificación: debería devolver 3 rows
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('acuerdos', 'cuotas', 'registros')
ORDER BY table_name;
