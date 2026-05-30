import { createClient } from '@supabase/supabase-js';
import { getEnv } from '@config/env';
import { logger } from '@utils/logger';

let client: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (client) return client;

  const env = getEnv();
  client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

  logger.debug({ url: env.SUPABASE_URL }, 'Supabase client initialized');
  return client;
}

export function closeDb() {
  if (client) {
    client = null;
  }
}
