function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}. Check .env.local (see .env.local.example).`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  // Server-only
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  // Public (safe in the browser)
  publicSupabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  publicSupabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),

  // Build-time only (schema migrations via the Management API)
  supabaseAccessToken: () => optional("SUPABASE_ACCESS_TOKEN"),
  supabaseProjectRef: () => optional("SUPABASE_PROJECT_REF"),

  // Seed script
  seedOwnerEmail: () => optional("SEED_OWNER_EMAIL"),
  seedOwnerPassword: () => optional("SEED_OWNER_PASSWORD"),
};
