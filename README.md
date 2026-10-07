# Bitcoin Technical Radar

Pay-per-call x402 API (USDC on Base): what actually changed in Bitcoin, with the evidence, and what has not happened yet.
Live: https://btc-radar.vercel.app (start at /llms.txt). Built and maintained by Aaron Zhang.

- `data/digest.json` — the current digest. Every item: status (proposal / merged / released / activated / documentation), layer (consensus / policy / p2p / wallet / standards / lightning), why it matters, `not_yet`, primary source links.
- `scripts/validate.mjs` — runs as the Vercel build step; a bad digest never deploys.
- `app.js` — Express + x402 paywall (CDP facilitator), Bazaar metadata, discovery files.

Summaries are written in our own words from primary sources; follow the links for original text. Not investment advice.
