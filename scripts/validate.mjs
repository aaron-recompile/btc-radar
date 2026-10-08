// Digest validator. Runs as the Vercel build step: a bad digest fails the build and the previous deploy stays live.
// Run locally with: node scripts/validate.mjs
import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync(new URL("../data/digest.json", import.meta.url), "utf8"));
const errors = [];
const err = (m) => errors.push(m);

for (const k of ["schema", "digest_date", "window", "generated_at", "status_scale", "layer_scale", "items", "publisher", "disclaimer"])
  if (d[k] === undefined) err(`missing top-level field "${k}"`);
const STATUSES = new Set(Object.keys(d.status_scale || {}));
const LAYERS = new Set(d.layer_scale || []);
// Sources we may link but must never use as the evidence for an item (terms forbid commercial or automated use).
const BANNED_HOSTS = [/sacra\.com/i];

const ids = new Set();
for (const it of d.items || []) {
  const at = `item "${it.id}"`;
  if (!it.id) err("item without id");
  if (ids.has(it.id)) err(`${at} duplicated`);
  ids.add(it.id);
  for (const k of ["project", "title", "layer", "status", "what_happened", "why_it_matters", "not_yet", "verification"])
    if (!it[k]) err(`${at} missing "${k}"`);
  if (it.status && !STATUSES.has(it.status)) err(`${at} unknown status "${it.status}"`);
  if (it.layer && !LAYERS.has(it.layer)) err(`${at} unknown layer "${it.layer}"`);
  if (it.layer === "consensus" && it.status !== "activated" && !/activat/i.test(it.not_yet || ""))
    err(`${at} is a consensus change that is not activated; not_yet must say so`);
  if (!Array.isArray(it.sources) || it.sources.length === 0) err(`${at} needs at least one source`);
  for (const s of it.sources || []) {
    if (!/^https:\/\//.test(s.url || "")) err(`${at} source needs an https url`);
    if (!s.publisher || !s.date) err(`${at} source needs publisher and date`);
    if (BANNED_HOSTS.some((re) => re.test(s.url || ""))) err(`${at} cites a banned source ${s.url}`);
  }
  for (const k of ["what_happened", "why_it_matters"])
    if ((it[k] || "").split(/\s+/).length > 90) err(`${at} ${k} is too long (keep summaries short, our own words)`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problem(s) in digest:\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`✓ digest ${d.digest_date} valid (${d.items.length} items)`);

// Live routes: metadata only (their data is read at request time).
const { LIVE } = await import("../lib/live.js");
for (const p of LIVE) {
  if (!p.description || p.description.length > 500) { console.error(`✗ ${p.path}: description length`); process.exit(1); }
  if (!(p.tags?.length >= 1 && p.tags.length <= 5 && p.tags.every((t) => /^[\x20-\x7E]{1,32}$/.test(t)))) { console.error(`✗ ${p.path}: tags`); process.exit(1); }
}
console.log(`✓ ${LIVE.length} live routes valid`);
