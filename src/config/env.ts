import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info'),

  SAAS_WEBHOOK_SECRET: z.string().min(1, 'SAAS_WEBHOOK_SECRET is required'),
  SAAS_API_URL: z.string().url().default('http://localhost:3000'),

  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-3-5-sonnet-20241022'),

  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email('GOOGLE_SERVICE_ACCOUNT_EMAIL must be valid email'),
  GOOGLE_SERVICE_ACCOUNT_KEY_BASE64: z.string().min(1, 'GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 is required'),
  GOOGLE_SHEETS_SPREADSHEET_ID: z.string().min(1, 'GOOGLE_SHEETS_SPREADSHEET_ID is required'),
  GOOGLE_DRIVE_ROOT_FOLDER_ID: z.string().min(1, 'GOOGLE_DRIVE_ROOT_FOLDER_ID is required'),

  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: z.string().min(1, 'SUPABASE_ANON_KEY is required'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  DATABASE_TYPE: z.enum(['sqlite', 'postgres']).default('sqlite'),
  DATABASE_PATH: z.string().default('./data/rdd.db'),
  DATABASE_URL: z.string().optional(),

  CLAUDE_MAX_CONTEXT_TURNS: z.coerce.number().int().positive().default(10),
  CLAUDE_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.3),

  GOOGLE_API_TIMEOUT: z.coerce.number().int().positive().default(30000),
  GOOGLE_API_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),

  UI_API_KEY: z.string().min(32, 'UI_API_KEY must be at least 32 characters'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  WEBHOOK_RATE_LIMIT: z.coerce.number().int().positive().default(100),
  CHAT_RATE_LIMIT: z.coerce.number().int().positive().default(30),

  ENABLE_AUDIT_LOGGING: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('true'),

  ENABLE_DETAILED_LOGGING: z
    .enum(['true', 'false'])
    .transform((val) => val === 'true')
    .default('false'),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const errorMessages = Object.entries(errors)
      .map(([field, msgs]) => `  ${field}: ${msgs?.join(', ')}`)
      .join('\n');

    throw new Error(`Environment validation failed:\n${errorMessages}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}
