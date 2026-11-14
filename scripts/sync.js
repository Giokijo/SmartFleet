// Copies the 4 published Google Sheets CSVs into Supabase. Node 20+, no dependencies.
// Env (GitHub Secrets): SUPABASE_URL, SUPABASE_SERVICE_KEY, SRC_SOS, SRC_AMT, SRC_LUBE, SRC_FAULT
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
const SOURCES = { sos: process.env.SRC_SOS, amt: process.env.SRC_AMT, lube: process.env.SRC_LUBE, fault: process.env.SRC_FAULT };
const CHUNK = 1500;

function parseCsv(s) {
  const t = []; let r = [], f = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { if (q && s[i + 1] === '"') { f += '"'; i++; } else q = !q; }
    else if (c === "," && !q) { r.push(f); f = ""; }
    else if ((c === "\n" || c === "\r") && !q) { if (c === "\r" && s[i + 1] === "\n") i++; r.push(f); f = ""; if (r.some(v => v.trim())) t.push(r); r = []; }
    else f += c;
  }
  r.push(f); if (r.some(v => v.trim())) t.push(r);
  if (!t.length) return [];
  const h = t.shift().map(x => x.replace(/^﻿/, "").trim());
  return t.map(v => Object.fromEntries(h.map((k, i) => [k, v[i] ?? ""]).filter(([k]) => k)));
}

const headers = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY };
if (SUPABASE_SERVICE_KEY.startsWith("eyJ")) headers.Authorization = `Bearer ${SUPABASE_SERVICE_KEY}`; // legacy JWT keys only

async function rpc(feed, rows, reset) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/load_feed`, {
    method: "POST", headers, body: JSON.stringify({ p_feed: feed, p_rows: rows, p_reset: reset }),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

let failed = 0;
for (const [feed, url] of Object.entries(SOURCES)) {
  try {
    if (!url) throw new Error(`Secret SRC_${feed.toUpperCase()} is not set`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Source HTTP ${res.status}`);
    const rows = parseCsv(await res.text());
    if (!rows.length) throw new Error("Source CSV is empty, existing data kept");
    for (let i = 0; i < rows.length; i += CHUNK) await rpc(feed, rows.slice(i, i + CHUNK), i === 0);
    console.log(`✓ ${feed}: ${rows.length} rows`);
  } catch (e) { failed++; console.error(`✗ ${feed}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
