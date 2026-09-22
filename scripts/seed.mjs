#!/usr/bin/env node
// Seed the first Owner login (and optional placeholder test accounts).
//   node scripts/seed.mjs
//
// Idempotent: skips users that already exist. Uses the Supabase Auth admin API
// (service_role). The on_auth_user_created trigger creates the profile row from
// the user_metadata we pass here.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
}

loadEnv();

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const ownerEmail = process.env.SEED_OWNER_EMAIL;
const ownerPassword = process.env.SEED_OWNER_PASSWORD;
if (!ownerEmail || !ownerPassword) {
  console.error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD in .env.local");
  process.exit(1);
}

// Add entries here to spin up placeholder role views for testing.
const PLACEHOLDERS = (process.env.SEED_PLACEHOLDERS === "1"
  ? [
      { email: "admin@example.com", password: "test-admin-pw", role: "admin", full_name: "Placeholder Admin" },
      { email: "editor1@example.com", password: "test-editor-pw", role: "editor", full_name: "Placeholder Editor One" },
      { email: "editor2@example.com", password: "test-editor-pw", role: "editor", full_name: "Placeholder Editor Two" },
      { email: "copywriter1@example.com", password: "test-copy-pw", role: "copywriter", full_name: "Placeholder Copywriter" },
      { email: "va1@example.com", password: "test-va-pw", role: "va", full_name: "Placeholder VA" },
    ]
  : []);

const accounts = [
  { email: ownerEmail, password: ownerPassword, role: "owner", full_name: "Owner" },
  ...PLACEHOLDERS,
];

async function findUserByEmail(email) {
  // paginate through users (fine at this scale)
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

for (const acct of accounts) {
  const existing = await findUserByEmail(acct.email);
  if (existing) {
    console.log(`• ${acct.email} already exists (${acct.role}) — ensuring profile`);
    // The on_auth_user_created trigger only fires for NEW auth users, so a
    // pre-existing user may have no profile row yet — upsert, don't update.
    await db.from("profiles").upsert(
      { id: existing.id, email: acct.email, role: acct.role, full_name: acct.full_name, active: true },
      { onConflict: "id" }
    );
    continue;
  }
  const { data, error } = await db.auth.admin.createUser({
    email: acct.email,
    password: acct.password,
    email_confirm: true,
    user_metadata: { role: acct.role, full_name: acct.full_name },
  });
  if (error) {
    console.error(`✗ ${acct.email}: ${error.message}`);
    process.exit(1);
  }
  // Belt and braces in case the trigger isn't installed yet.
  await db
    .from("profiles")
    .upsert({ id: data.user.id, email: acct.email, role: acct.role, full_name: acct.full_name });
  console.log(`✓ created ${acct.email} (${acct.role})`);
}

console.log("\nDone. Sign in at /login and change the owner password immediately.");
