import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son requeridas');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

async function addPendingActionColumn() {
  console.log('Verificando columna pending_action en conversations...');

  const { error } = await db
    .from('conversations')
    .select('pending_action')
    .limit(1);

  if (!error) {
    console.log('La columna pending_action ya existe. No se requiere migración.');
    return;
  }

  console.log('La columna no existe. Ejecuta este SQL en Supabase Dashboard → SQL Editor:');
  console.log('');
  console.log("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pending_action TEXT CHECK (pending_action = 'ask_acuerdo_terms' OR pending_action IS NULL);");
  console.log('');
  console.log('Después de ejecutar el SQL, vuelve a correr este script para verificar.');
  process.exit(0);
}

addPendingActionColumn().catch(console.error);
