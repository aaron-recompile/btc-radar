// Deterministic data: read straight from GitHub and npm at request time, cache for a few hours,
// serve the last good copy if an upstream call fails. Nothing is rewritten by a language model.
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

async function getJSON(url) {
  const headers = { "User-Agent": "protocol-radar", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com")) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export async function cached(key, build) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { ...hit.value, cache: "fresh" };
  try {
    const value = await build();
    cache.set(key, { at: Date.now(), value });
    return { ...value, cache: "refreshed" };
  } catch (e) {
    if (hit) return { ...hit.value, cache: "stale", stale_reason: String(e.message).slice(0, 120) };
    throw e;
  }
}

const SECURITY = /\b(security|vulnerab|CVE-\d|critical|high[- ]priority|urgent|exploit|consensus bug|must upgrade|mandatory)\b/i;

export async function latestRelease(repo) {
  // GitHub's "latest" flag, not newest-by-date: projects publish maintenance releases for older branches after newer ones.
  const [rels, latest] = await Promise.all([
    getJSON(`https://api.github.com/repos/${repo}/releases?per_page=8`),
    getJSON(`https://api.github.com/repos/${repo}/releases/latest`).catch(() => null),
  ]);
  const r = latest || rels.find((x) => !x.draft && !x.prerelease) || rels.find((x) => !x.draft);
  if (!r) return { repo, latest: null };
  return {
    repo, version: r.tag_name, name: r.name || r.tag_name, published_at: r.published_at, prerelease: r.prerelease, url: r.html_url,
    days_since: Math.floor((Date.now() - Date.parse(r.published_at)) / 86_400_000),
    security_keyword_in_notes: SECURITY.test(r.body || ""),
    recent_releases: rels.filter((x) => !x.draft).slice(0, 5).map((x) => ({
      version: x.tag_name, published_at: x.published_at, prerelease: x.prerelease, security_keyword_in_notes: SECURITY.test(x.body || ""), url: x.html_url })),
    note: "version = the release GitHub marks as latest; recent_releases includes maintenance releases of older branches. security_keyword_in_notes is a plain keyword match, not an assessment.",
  };
}

export async function latestTags(repo, n = 5) {
  const tags = await getJSON(`https://api.github.com/repos/${repo}/tags?per_page=${n}`);
  return tags.map((t) => ({ tag: t.name, url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(t.name)}` }));
}

export async function mergedPRs(repo, n = 15) {
  const prs = await getJSON(`https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`);
  return prs.filter((p) => p.merged_at).sort((a, b) => b.merged_at.localeCompare(a.merged_at)).slice(0, n)
    .map((p) => ({ number: p.number, title: p.title, merged_at: p.merged_at, labels: p.labels.map((l) => l.name), url: p.html_url }));
}

export async function npmVersions(pkgs) {
  const out = [];
  for (const name of pkgs) {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace("%40", "@")}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { out.push({ package: name, error: r.status }); continue; }
    const d = await r.json();
    const v = d["dist-tags"]?.latest;
    out.push({ package: name, latest: v, published_at: d.time?.[v], url: `https://www.npmjs.com/package/${name}` });
  }
  return out;
}

// BIP index: the table in bitcoin/bips README.mediawiki (number, layer, title, owners, type, status).
export async function bipIndex() {
  const r = await fetch("https://raw.githubusercontent.com/bitcoin/bips/master/README.mediawiki", { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${r.status} bips README`);
  const text = await r.text();
  const rows = [];
  for (const block of text.split(/\n\|-[^\n]*\n/).slice(1)) {
    const cells = block.split("\n").filter((l) => l.startsWith("|") && !l.startsWith("|}")).map((l) => l.slice(1).trim());
    const m = cells[0]?.match(/\[\[bip-(\d+)\.(?:mediawiki|md)\|(\d+)\]\]/);
    if (!m || cells.length < 6) continue;
    rows.push({ bip: Number(m[2]), layer: cells[1] || null, title: cells[2], type: cells[4], status: cells[5],
      url: `https://github.com/bitcoin/bips/blob/master/bip-${m[1]}.${cells[0].includes(".md|") ? "md" : "mediawiki"}` });
  }
  return rows;
}
