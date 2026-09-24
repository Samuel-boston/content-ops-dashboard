/**
 * The largest single file a browser can upload straight to Supabase Storage.
 * Supabase's own project setting is the real limit (50 MB on the free plan);
 * after upgrading, raise it in Supabase (Storage → Settings) AND set
 * NEXT_PUBLIC_MAX_UPLOAD_MB to match in the project's environment variables.
 */
export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 50;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
