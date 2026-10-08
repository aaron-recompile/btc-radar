// Bitcoin Technical Radar: what actually changed in Bitcoin, with the evidence, and what has NOT happened yet.
// Paid via x402 (USDC on Base), settled through the CDP facilitator so routes are listed in the x402 Bazaar.
import express from "express";
import { readFileSync } from "node:fs";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { facilitator } from "@coinbase/x402"; // reads CDP_API_KEY_ID / CDP_API_KEY_SECRET
import { LIVE } from "./lib/live.js";
import { RELATED } from "./lib/related.js";

const PAY_TO = "0x4b5887B6E399C2E104becd01f7c406229c15891d";
const MAKER = { name: "Aaron Zhang", role: "independent developer", url: "https://farcaster.xyz/aaronzhang" };
const SERVICE_NAME = "Bitcoin Tech Radar - Aaron Zhang"; // Bazaar serviceName: printable ASCII, <= 32 chars
const NETWORKS = (process.env.X402_NETWORKS || "eip155:84532").split(",");
const digest = JSON.parse(readFileSync(new URL("./data/digest.json", import.meta.url)));

const SERVICE = {
  name: "Bitcoin Technical Radar by Aaron Zhang",
  summary: "What actually changed in Bitcoin, as JSON: each item has its status (discussion, proposal, PR, merged, released, activated, documentation), the layer it touches (consensus, policy, p2p, wallet, standards, lightning), why it matters, what has NOT happened yet, and links to the original source.",
  notThis: "Not price data, not general crypto news, not investment advice. A proposal is not support; merged is not released; released is not activated.",
  maker: `Built and maintained by ${MAKER.name}, an ${MAKER.role} and Bitcoin protocol researcher. Summaries are written in our own words from primary sources (GitHub, BIPs, release notes).`,
};
const PAID_PATH = "/bitcoin/technical-updates";
const PRICE = "0.01";
const TAGS = ["bitcoin", "bitcoin-core", "bip", "protocol", "lightning"];
const DESCRIPTION =
  "Bitcoin protocol and software changes as JSON: Bitcoin Core merges and releases, BIP updates, Lightning spec and implementation changes. Each item has status (proposal, merged, released, activated), layer (consensus, policy, p2p, wallet), why it matters, what has not happened yet, and primary source links.";

const facilitatorConfig = process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
  ? { ...facilitator, timeoutMs: 15_000 }
  : { url: "https://x402.org/facilitator", timeoutMs: 15_000 }; // local testnet dev without CDP keys

// Fail fast and retry instead of one 90s hang on a cold start.
class RetryingFacilitatorClient extends HTTPFacilitatorClient {
  async getSupported() {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await super.getSupported(); } catch (e) {
        lastError = e;
        console.warn(JSON.stringify({ event: "facilitator_supported_retry", attempt, error: String(e?.message || e).slice(0, 160) }));
      }
    }
    throw lastError;
  }
}

const server = new x402ResourceServer(new RetryingFacilitatorClient(facilitatorConfig));
for (const n of NETWORKS) server.register(n, new ExactEvmScheme());
server.registerExtension(bazaarResourceServerExtension);
server.onAfterSettle(async (ctx) => {
  console.log(JSON.stringify({ event: "sale", resource: ctx.paymentPayload?.resource?.url, network: ctx.requirements?.network,
    amount: ctx.requirements?.amount, payer: ctx.result?.payer, tx: ctx.result?.transaction, success: ctx.result?.success }));
});

const sampleItem = () => digest.items[0];
const status = () => ({
  digest_date: digest.digest_date, window: digest.window, generated_at: digest.generated_at, items: digest.items.length,
  by_status: digest.items.reduce((m, i) => ({ ...m, [i.status]: (m[i.status] || 0) + 1 }), {}),
  projects: [...new Set(digest.items.map((i) => i.project))],
});

const app = express();
app.set("trust proxy", true); // Vercel terminates TLS; advertise https resource URLs
const PAID_PATHS = new Set([PAID_PATH, ...LIVE.map((p) => p.path)]);
app.use((req, res, next) => (req.method === "HEAD" && PAID_PATHS.has(req.path) ? res.status(402).end() : next()));

app.use(paymentMiddleware({
  [`GET ${PAID_PATH}`]: {
    accepts: NETWORKS.map((network) => ({ scheme: "exact", price: `$${PRICE}`, network, payTo: PAY_TO })),
    description: DESCRIPTION,
    mimeType: "application/json",
    serviceName: SERVICE_NAME,
    tags: TAGS,
    iconUrl: "https://btc-radar.vercel.app/icon.svg",
    extensions: { ...declareDiscoveryExtension({ output: { example: { digest_date: digest.digest_date, items: [sampleItem()] } } }) },
  },
  ...Object.fromEntries(LIVE.map((p) => [`GET ${p.path}`, {
    accepts: NETWORKS.map((network) => ({ scheme: "exact", price: `$${p.price}`, network, payTo: PAY_TO })),
    description: p.description, mimeType: "application/json", serviceName: SERVICE_NAME, tags: p.tags,
    iconUrl: "https://btc-radar.vercel.app/icon.svg",
    extensions: { ...declareDiscoveryExtension({ output: { example: { dataset: p.path.slice(1).replace("/", "-"), generated_at: "2026-10-08T00:00:00Z" } } }) },
  }])),
}, server));
for (const p of LIVE) {
  app.get(p.path, async (req, res) => {
    try { res.send({ ...(await p.build()), publisher: digest.publisher }); }
    catch (e) { res.status(503).send({ error: "upstream unavailable", detail: String(e.message).slice(0, 160) }); }
  });
}

const origin = (req) => `${req.protocol}://${req.get("host")}`;
const howToPay = "GET the endpoint; receive HTTP 402 with a PAYMENT-REQUIRED header; sign and retry with PAYMENT-SIGNATURE (x402 v2, scheme exact). No API key, no account.";

app.get("/", (req, res) => res.send({
  service: SERVICE.name, maker: MAKER, what: SERVICE.summary, not: SERVICE.notThis,
  pay: { protocol: "x402", asset: "USDC", networks: NETWORKS, price_usdc: PRICE },
  paid: [PAID_PATH, ...LIVE.map((p) => p.path)], free: ["/bitcoin/status", "/bitcoin/sample"],
  more_from_this_developer: RELATED.filter((r) => !r.url.includes("btc-radar")),
  discovery: ["/llms.txt", "/.well-known/x402", "/openapi.json", "/agents.json"],
}));
app.get("/bitcoin/status", (req, res) => res.send(status()));
app.get("/bitcoin/sample", (req, res) => res.send({ note: "One free item from the current digest. The paid endpoint returns all items.", item: sampleItem(), status: status() }));
app.get(PAID_PATH, (req, res) => res.send(digest));

app.get("/.well-known/x402", (req, res) => {
  const o = origin(req);
  res.send({
    x402Version: 2, service: SERVICE.name, serviceName: SERVICE_NAME, maker: MAKER, iconUrl: `${o}/icon.svg`,
    description: `${SERVICE.summary} ${SERVICE.notThis} ${SERVICE.maker}`,
    docs: `${o}/llms.txt`, openapi: `${o}/openapi.json`,
    rails: NETWORKS.map((network) => ({ rail: "x402", version: 2, scheme: "exact", network, asset: "USDC", how: howToPay })),
    payTo: PAY_TO,
    resources: [
      { resource: `${o}/bitcoin/status`, method: "GET", description: "Free: digest date, window, item counts by status.", priceUsd: 0, free: true },
      { resource: `${o}/bitcoin/sample`, method: "GET", description: "Free: one item from the current digest.", priceUsd: 0, free: true },
      { resource: `${o}${PAID_PATH}`, method: "GET", description: DESCRIPTION, priceUsd: Number(PRICE), free: false, networks: NETWORKS, tags: TAGS, digest_date: digest.digest_date },
      ...LIVE.map((p) => ({ resource: `${o}${p.path}`, method: "GET", description: p.description, priceUsd: Number(p.price), free: false, networks: NETWORKS, tags: p.tags })),
    ],
    related_services: RELATED.filter((r) => !r.url.includes("btc-radar")),
  });
});

app.get("/openapi.json", (req, res) => {
  const o = origin(req);
  res.send({
    openapi: "3.1.0",
    info: { title: SERVICE.name, version: "1.0.0", description: `${SERVICE.summary} ${SERVICE.notThis} ${SERVICE.maker}`,
      contact: { name: `${MAKER.name} (${MAKER.role})`, url: MAKER.url } },
    servers: [{ url: o }],
    paths: {
      "/bitcoin/status": { get: { summary: "Free digest status", responses: { 200: { description: "Digest date, window, counts." } } } },
      "/bitcoin/sample": { get: { summary: "Free sample item", responses: { 200: { description: "One item." } } } },
      [PAID_PATH]: { get: {
        summary: "Bitcoin technical updates digest", description: DESCRIPTION, tags: TAGS,
        "x-payment-info": { protocol: "x402", version: 2, scheme: "exact", priceUsd: Number(PRICE), asset: "USDC", networks: NETWORKS, payTo: PAY_TO },
        responses: {
          200: { description: "Digest (btc-radar/v1).", content: { "application/json": { schema: { $ref: "#/components/schemas/Digest" } } } },
          402: { description: "Payment required. Terms in the PAYMENT-REQUIRED header (base64 JSON)." },
        },
      } },
      ...Object.fromEntries(LIVE.map((p) => [p.path, { get: { summary: p.path, description: p.description, tags: p.tags,
        "x-payment-info": { protocol: "x402", version: 2, scheme: "exact", priceUsd: Number(p.price), asset: "USDC", networks: NETWORKS, payTo: PAY_TO },
        responses: { 200: { description: "Dataset JSON with generated_at, method and sources." }, 402: { description: "Payment required." } } } }])),
    },
    components: { schemas: { Digest: {
      type: "object", required: ["schema", "digest_date", "items"],
      properties: {
        digest_date: { type: "string", format: "date" },
        items: { type: "array", items: { type: "object", required: ["id", "project", "title", "layer", "status", "what_happened", "why_it_matters", "not_yet", "sources"],
          properties: {
            id: { type: "string" }, project: { type: "string" }, title: { type: "string" },
            layer: { enum: digest.layer_scale }, status: { enum: Object.keys(digest.status_scale) },
            what_happened: { type: "string" }, why_it_matters: { type: "string" }, affects: { type: "array", items: { type: "string" } },
            not_yet: { type: "string", description: "What has NOT happened yet (e.g. not released, not activated)." },
            uncertainty: { type: "string" },
            sources: { type: "array", items: { type: "object", properties: { publisher: { type: "string" }, date: { type: "string" }, url: { type: "string" } } } },
          } } },
      },
    } } },
  });
});

app.get("/llms.txt", (req, res) => {
  const o = origin(req);
  res.type("text/plain").send(`# ${SERVICE.name}

> ${SERVICE.summary}

${SERVICE.notThis}

${SERVICE.maker} Contact: ${MAKER.url}

## Why use this
- Status is explicit: a BIP draft, an open PR, a merge to master, a release and a mainnet activation are different things, and each item says which one it is.
- Every item says what has NOT happened yet, so an agent does not report a proposal as a shipped feature.
- Primary sources only (GitHub pull requests, BIPs, release notes), linked per item.

## Endpoints
- [Status](${o}/bitcoin/status): free. Digest date, window, counts by status.
- [Sample](${o}/bitcoin/sample): free. One item.
- [Technical updates](${o}${PAID_PATH}): ${PRICE} USDC per call. Current digest dated ${digest.digest_date}, ${digest.items.length} items.
${LIVE.map((p) => `- [${p.path}](${o}${p.path}): ${p.price} USDC. ${p.description}`).join("\n")}

## How to pay
${howToPay}
Networks: ${NETWORKS.join(", ")} (USDC). Pay to ${PAY_TO}.

## Status scale
${Object.entries(digest.status_scale).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

## More from this developer
${RELATED.filter((r) => !r.url.includes("btc-radar")).map((r) => `- [${r.name}](${r.url}/llms.txt): ${r.what}`).join("\n")}

## Machine-readable
- [x402 manifest](${o}/.well-known/x402)
- [OpenAPI](${o}/openapi.json)
- [agents.json](${o}/agents.json)

Summaries are our own words; follow the links for original text. Not investment advice.
`);
});

app.get("/agents.json", (req, res) => {
  const o = origin(req);
  res.send({ name: SERVICE.name, description: SERVICE.summary, provider: MAKER, url: o,
    auth: { type: "x402", networks: NETWORKS, asset: "USDC", payTo: PAY_TO },
    capabilities: [{ id: "bitcoin_technical_updates", description: DESCRIPTION, method: "GET", url: `${o}${PAID_PATH}`, priceUsd: Number(PRICE), tags: TAGS },
      ...LIVE.map((p) => ({ id: p.path.slice(1).replace(/\//g, "_"), description: p.description, method: "GET", url: `${o}${p.path}`, priceUsd: Number(p.price), tags: p.tags }))],
    related_services: RELATED.filter((r) => !r.url.includes("btc-radar")),
    docs: { llms: `${o}/llms.txt`, openapi: `${o}/openapi.json`, x402: `${o}/.well-known/x402` } });
});

app.get("/icon.svg", (req, res) =>
  res.type("image/svg+xml").send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#1b1b1f"/><text x="32" y="44" font-family="Helvetica,Arial,sans-serif" font-size="34" font-weight="700" fill="#f7931a" text-anchor="middle">&#8383;</text></svg>`),
);
app.get("/robots.txt", (req, res) =>
  res.type("text/plain").send(`User-agent: *\nAllow: /\n\n# Agents: start at ${origin(req)}/llms.txt or ${origin(req)}/.well-known/x402\n`),
);

export default app;
if (!process.env.VERCEL) app.listen(4024, () => console.log("http://localhost:4024/"));
