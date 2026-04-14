/* eslint-disable no-console */
const http = require("http");
const path = require("path");
const express = require("express");
const WebSocket = require("ws");
const { generateJwt } = require("@coinbase/cdp-sdk/auth");

const PORT = Number.parseInt(process.env.PORT || "8080", 10);
const HOST = process.env.HOST || "0.0.0.0";
const webRoot = __dirname;

const PRODUCT_ID = process.env.PRODUCT_ID || "BTC-USD";
const COINBASE_WS_URL =
  process.env.COINBASE_WS_URL ||
  "wss://advanced-trade-ws.coinbase.com";

const app = express();
app.use(express.json({ limit: "128kb" }));
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
app.use(express.static(webRoot, { extensions: ["html"] }));
app.get("/", (_req, res) => res.sendFile(path.join(webRoot, "index.html")));

const server = http.createServer(app);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Browser WebSocket: ws://localhost:8080/ws
const wss = new WebSocket.Server({ server, path: "/ws" });

function broadcast(messageObj) {
  const message = JSON.stringify(messageObj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

// Upstream Coinbase public market-data websocket (no auth).
let upstream = null;
let upstreamConnected = false;

function connectUpstream() {
  upstream = new WebSocket(COINBASE_WS_URL);

  upstream.on("open", () => {
    upstreamConnected = true;
    console.log(`🛰️  Connected to Coinbase WS: ${COINBASE_WS_URL}`);

    // Heartbeats keep connections alive when a product is quiet.
    upstream.send(JSON.stringify({ type: "subscribe", channel: "heartbeats" }));

    const subscribe = {
      type: "subscribe",
      product_ids: [PRODUCT_ID],
      channel: "level2",
    };
    const subscribeTrades = {
      type: "subscribe",
      product_ids: [PRODUCT_ID],
      channel: "market_trades",
    };
    const subscribeTicker = {
      type: "subscribe",
      product_ids: [PRODUCT_ID],
      channel: "ticker",
    };

    upstream.send(JSON.stringify(subscribe));
    upstream.send(JSON.stringify(subscribeTrades));
    upstream.send(JSON.stringify(subscribeTicker));
  });

  upstream.on("message", (data) => {
    const msg = safeJsonParse(data.toString("utf8"));
    if (!msg) return;

    // Forward a simplified shape the frontend can consume.
    if (msg.channel === "level2" && msg.events?.length) {
      // Coinbase sends snapshots + updates as "events".
      // We pass them through and normalize in the browser.
      broadcast({ type: "coinbase", channel: "level2", product_id: PRODUCT_ID, payload: msg });
      return;
    }

    if (msg.channel === "market_trades" && msg.events?.length) {
      broadcast({ type: "coinbase", channel: "market_trades", product_id: PRODUCT_ID, payload: msg });
      return;
    }

    if (msg.channel === "ticker" && msg.events?.length) {
      broadcast({ type: "coinbase", channel: "ticker", product_id: PRODUCT_ID, payload: msg });
      return;
    }

    if (msg.channel === "heartbeats" && msg.events?.length) {
      broadcast({ type: "coinbase", channel: "heartbeats", product_id: PRODUCT_ID, payload: msg });
      return;
    }
  });

  upstream.on("close", () => {
    upstreamConnected = false;
    console.log("🛰️  Coinbase WS disconnected; reconnecting in 2s...");
    setTimeout(connectUpstream, 2000).unref();
  });

  upstream.on("error", (err) => {
    upstreamConnected = false;
    console.log(`🛰️  Coinbase WS error: ${err?.message || err}`);
    try {
      upstream.close();
    } catch {
      // ignore
    }
  });
}

connectUpstream();

function getRestConfig() {
  const baseUrl = process.env.COINBASE_REST_URL || "https://api.coinbase.com";
  const url = new URL(baseUrl);
  return { baseUrl, host: url.host };
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function coinbaseAuthedFetch({ method, path, body }) {
  const { baseUrl, host } = getRestConfig();
  const url = new URL(path, baseUrl);

  const keyName = requireEnv("COINBASE_KEY_NAME");
  const keySecret = requireEnv("COINBASE_PRIVATE_KEY");

  const jwt = await generateJwt({
    keyName,
    keySecret,
    requestMethod: method,
    requestHost: host,
    requestPath: url.pathname,
    expiresInSeconds: 60,
  });

  const resp = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  const json = safeJsonParse(text);
  if (!resp.ok) {
    const message = json?.message || json?.error || text || `HTTP ${resp.status}`;
    const err = new Error(message);
    err.status = resp.status;
    err.details = json || text;
    throw err;
  }
  return json ?? text;
}

// Minimal "paper trading" endpoints.
// NOTE: Coinbase Advanced Trade "Sandbox" behavior may be simulated/static depending on the key type.
// Set `COINBASE_REST_URL=https://api-sandbox.coinbase.com` to target sandbox if available for your keys.
app.get("/api/paper/products", async (_req, res) => {
  try {
    const data = await coinbaseAuthedFetch({ method: "GET", path: "/api/v3/brokerage/products" });
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), details: e.details });
  }
});

app.get("/api/paper/accounts", async (_req, res) => {
  try {
    const data = await coinbaseAuthedFetch({ method: "GET", path: "/api/v3/brokerage/accounts" });
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), details: e.details });
  }
});

app.post("/api/paper/order", async (req, res) => {
  try {
    const {
      product_id,
      side,
      base_size,
      limit_price,
      post_only = true,
      client_order_id,
    } = req.body || {};

    if (!product_id || !side || !base_size || !limit_price) {
      res.status(400).json({
        error: "Missing required fields: product_id, side, base_size, limit_price",
      });
      return;
    }

    // Advanced Trade API requires an order_configuration payload.
    const body = {
      client_order_id: client_order_id || `paper-${Date.now()}`,
      product_id,
      side,
      order_configuration: {
        limit_limit_gtc: {
          base_size: String(base_size),
          limit_price: String(limit_price),
          post_only: Boolean(post_only),
        },
      },
    };

    const data = await coinbaseAuthedFetch({ method: "POST", path: "/api/v3/brokerage/orders", body });
    res.json(data);
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), details: e.details });
  }
});

wss.on("connection", (ws) => {
  ws.send(
    JSON.stringify({
      type: "hello",
      mode: "market-data",
      product_id: PRODUCT_ID,
      upstream_connected: upstreamConnected,
      note:
        "Market-data is live via Coinbase WS. Paper endpoints: /api/paper/* (requires COINBASE_KEY_NAME + COINBASE_PRIVATE_KEY).",
    }),
  );
});

server.listen(PORT, HOST, () => {
  console.log("🚀 HFT FPGA Web Demo (Node)");
  console.log(`📡 http://localhost:${PORT}`);
  console.log(`📈 Product: ${PRODUCT_ID}`);
});
