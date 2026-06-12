# Migraciones de Base de Datos — RDD

Schema versionado de Supabase PostgreSQL. **Regla: ningún cambio de schema fuera de este directorio** (CLAUDE.md / Etapa 2.2).

## Cómo funciona

- Archivos SQL numerados: `0001_baseline.sql`, `0002_<descripcion>.sql`, …
- Cada migración es **idempotente** (`IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`) y termina registrándose en la tabla `schema_migrations`.
- Se aplican **en orden** en el SQL Editor del Dashboard de Supabase (el cliente service-role solo habla PostgREST, no SQL crudo).

## Aplicar migraciones

1. Ver cuáles están aplicadas: `npm run db:status`
2. Abrir Supabase Dashboard → SQL Editor
3. Pegar y ejecutar cada migración pendiente, en orden
4. Re-ejecutar `npm run db:status` para confirmar

## Crear una migración nueva

1. Crear `db/migrations/NNNN_descripcion.sql` (NNNN = siguiente número)
2. SQL idempotente + al final:
   ```sql
   INSERT INTO schema_migrations (version) VALUES ('NNNN_descripcion')
   ON CONFLICT (version) DO NOTHING;
   ```
3. Actualizar los tipos TypeScript en `src/database/schema.ts` para que coincidan
4. Commit de migración + tipos juntos

## Provisionar un proyecto Supabase nuevo

Ejecutar `0001_baseline.sql` completo en el SQL Editor — crea las 6 tablas
(conversations, messages, audit_log, acuerdos, cuotas, registros), índices,
grants y `schema_migrations`. Luego actualizar `SUPABASE_URL` y
`SUPABASE_SERVICE_ROLE_KEY` en `.env`/`.env.local`.

> Nota (2026-06-12): el baseline fue reconstruido desde las fuentes documentadas
> del repo porque el proyecto Supabase original (`wmfsxezf….supabase.co`) ya no
> resuelve DNS. Si se recupera acceso a una instancia previa con datos, verificar
> el schema real contra este baseline antes de aplicar nada.

## Historial pre-baseline (referencia)

| Fase | Cambio | Fuente |
|------|--------|--------|
| 5.3 | conversations/messages/audit_log normalizados en Postgres | src/database/schema.ts |
| 6.1 | acuerdos, cuotas, registros | docs/FASE_6_1_DDL.sql |
| 9.1 | case_state activa\|cerrada + motivo_cierre + sub_etapa_saas | scripts/migrate-case-states.ts |
| 9.2 | conversations.pending_action | scripts/add-pending-action-column.ts |
