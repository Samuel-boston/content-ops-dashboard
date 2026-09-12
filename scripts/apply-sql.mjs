#!/usr/bin/env node
// Apply a .sql file to the Supabase project via the Management API.
//   node scripts/apply-sql.mjs supabase/schema.sql
//   npm run db:push            (defaults to supabase/schema.sql)
//
// Needs SUPABASE_ACCESS_TOKEN (https://supabase.com/dashboard/account/tokens)
// and SUPABASE_PROJECT_REF in .env.local.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}

loadEnv();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref = process.env.SUPABASE_PROJECT_REF;
const file = process.argv[2] || "supabase/schema.sql";

if (!token || !ref) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF in .env.local.\n" +
      "Create a token at https://supabase.com/dashboard/account/tokens"
  );
  process.exit(1);
}

const sql = readFileSync(resolve(process.cwd(), file), "utf8");

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

const text = await res.text();
if (!res.ok) {
  console.error(`✗ ${file} failed (${res.status})`);
  console.error(text);
  process.exit(1);
}

console.log(`✓ applied ${file}`);
if (text && text !== "[]") console.log(text);
