// HFT FPGA Simulator - Live Demo
// This page can run in two modes:
// - Local simulation (no network)
// - Live market-data via ws://localhost:8080/ws (Coinbase Advanced market data proxied by Node)
let running = false;
let simulationInterval;
let orderBook = { bids: [], asks: [] };
let metrics = { latency: 0, throughput: 0, pnl: 0, position: 0, volume24h: null };
let trades = [];
let pnlHistory = [];

let liveMode = false;
let liveSocket = null;
let liveProductId = "BTC-USD";

// Live L2 state (price -> size)
const liveBids = new Map();
const liveAsks = new Map();

const recentPrints = []; // {side:'B'|'S', qty:number, price:number, time:string}
const recentPrices = []; // number

class HFTSimulator {
    constructor() {
        this.symbol = 'AAPL';
        this.basePrice = 15000; // cents
        this.orderId = 10000;
        this.position = 0;
        this.pnl = 0;
        this.eventCount = 0;
        this.startTime = null;
        this.latencies = [];
    }
    
    generateMarketEvent() {
        const side = Math.random() > 0.5 ? 'B' : 'S';
        const priceOffset = Math.floor(Math.random() * 100) - 50;
        const price = this.basePrice + priceOffset;
        const qty = 100 + Math.floor(Math.random() * 50) * 10;
        
        return {
            orderId: ++this.orderId,
            symbol: this.symbol,
            price: price,
            quantity: qty,
            side: side,
            timestamp: Date.now()
        };
    }
    
    updateOrderBook(event) {
        const bookSide = event.side === 'B' ? orderBook.bids : orderBook.asks;
        
        // Add to order book
        const existing = bookSide.find(l => l.price === event.price);
        if (existing) {
            existing.size += event.quantity;
            existing.orders++;
        } else {
            bookSide.push({
                price: event.price,
                size: event.quantity,
                orders: 1
            });
        }
        
        // Sort: bids descending, asks ascending
        if (event.side === 'B') {
            orderBook.bids.sort((a, b) => b.price - a.price);
            orderBook.bids = orderBook.bids.slice(0, 10);
        } else {
            orderBook.asks.sort((a, b) => a.price - b.price);
            orderBook.asks = orderBook.asks.slice(0, 10);
        }
        
        // Simulate trade execution every 5 events
        if (++this.eventCount % 5 === 0) {
            this.executeTrade(event);
        }
    }
    
    executeTrade(event) {
        const trade = {
            id: this.eventCount,
            price: event.price / 100,
            quantity: event.quantity,
            side: event.side,
            time: new Date().toLocaleTimeString()
        };
        trades.unshift(trade);
        if (trades.length > 20) trades.pop();
        
        // Update position and P&L
        if (event.side === 'B') {
            this.position += event.quantity;
            this.pnl -= event.price * event.quantity;
        } else {
            this.position -= event.quantity;
            this.pnl += event.price * event.quantity;
        }
        
        metrics.position = this.position;
        metrics.pnl = this.pnl / 100;
        pnlHistory.push(metrics.pnl);
        if (pnlHistory.length > 50) pnlHistory.shift();
    }
    
    calculateMetrics() {
        const elapsed = (Date.now() - this.startTime) / 1000;
        metrics.throughput = Math.floor(this.eventCount / elapsed);
        metrics.latency = Math.floor(200 + Math.random() * 300); // 200-500ns simulated
        
        // Calculate spread and mid
        const bestBid = orderBook.bids[0]?.price || 0;
        const bestAsk = orderBook.asks[0]?.price || 0;
        const spread = bestAsk > 0 && bestBid > 0 ? (bestAsk - bestBid) / 100 : 0;
        const mid = (bestBid + bestAsk) / 200;
        
        return { spread, mid };
    }
}

const simulator = new HFTSimulator();

function fmtNumber(value, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtSize(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    const v = Number(value);
    if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
    return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function fmtCompact(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) return "—";
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
    return v.toFixed(2);
}

function computeDepthArraysFromMaps(maxLevels = 10) {
    const bids = Array.from(liveBids.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => b.price - a.price)
        .slice(0, maxLevels);

    const asks = Array.from(liveAsks.entries())
        .map(([price, size]) => ({ price, size }))
        .sort((a, b) => a.price - b.price)
        .slice(0, maxLevels);

    // Convert into the existing UI shape
    orderBook = {
        bids: bids.map(l => ({ price: Math.round(l.price * 100), size: l.size, orders: "—" })),
        asks: asks.map(l => ({ price: Math.round(l.price * 100), size: l.size, orders: "—" })),
    };

    const bestBid = bids[0]?.price ?? 0;
    const bestAsk = asks[0]?.price ?? 0;
    const spread = bestBid > 0 && bestAsk > 0 ? (bestAsk - bestBid) : 0;
    const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;

    return { spread, mid };
}

function computeDepthSums(mid, pct) {
    if (!mid || !Number.isFinite(mid)) return { bid: 0, ask: 0 };
    const bidMin = mid * (1 - pct);
    const askMax = mid * (1 + pct);

    let bidSum = 0;
    for (const [price, size] of liveBids.entries()) {
        if (price >= bidMin) bidSum += size;
    }
    let askSum = 0;
    for (const [price, size] of liveAsks.entries()) {
        if (price <= askMax) askSum += size;
    }
    return { bid: bidSum, ask: askSum };
}

function applyCoinbaseLevel2(payload) {
    // payload.payload is the full Coinbase message as forwarded by server.js
    const msg = payload?.payload;
    if (!msg?.events?.length) return;

    for (const ev of msg.events) {
        if (ev.type === "snapshot") {
            liveBids.clear();
            liveAsks.clear();

            const bids = ev.bids || [];
            const asks = ev.asks || [];
            for (const [p, s] of bids) {
                const price = Number(p);
                const size = Number(s);
                if (size > 0) liveBids.set(price, size);
            }
            for (const [p, s] of asks) {
                const price = Number(p);
                const size = Number(s);
                if (size > 0) liveAsks.set(price, size);
            }
        } else if (ev.type === "update") {
            const updates = ev.updates || [];
            for (const u of updates) {
                const side = u.side; // "bid" or "offer"
                const price = Number(u.price_level);
                const size = Number(u.new_quantity);
                if (!Number.isFinite(price) || !Number.isFinite(size)) continue;

                const book = side === "bid" ? liveBids : liveAsks;
                if (size <= 0) book.delete(price);
                else book.set(price, size);
            }
        }
    }
}

function applyCoinbaseTrades(payload) {
    const msg = payload?.payload;
    if (!msg?.events?.length) return;

    for (const ev of msg.events) {
        const t = ev.trades || [];
        for (const tr of t) {
            const side = tr.side === "BUY" ? "B" : "S";
            const price = Number(tr.price);
            const quantity = Number(tr.size);
            const time = new Date(tr.time).toLocaleTimeString();

            trades.unshift({
                id: tr.trade_id || String(Date.now()),
                price,
                quantity,
                side,
                time,
            });

            recentPrints.unshift({ side, price, qty: quantity, time });
            if (recentPrints.length > 200) recentPrints.length = 200;

            if (Number.isFinite(price)) {
                recentPrices.push(price);
                if (recentPrices.length > 600) recentPrices.shift();
            }
        }
    }

    if (trades.length > 30) trades = trades.slice(0, 30);
}

function applyCoinbaseTicker(payload) {
    const msg = payload?.payload;
    if (!msg?.events?.length) return;

    const last = msg.events[msg.events.length - 1];
    const tick = last?.tickers?.[0];
    if (!tick) return;

    metrics.volume24h = tick.volume_24_h ? Number(tick.volume_24_h) : metrics.volume24h;
}

function connectLive() {
    try {
        liveSocket = new WebSocket(`ws://${window.location.host}/ws`);
    } catch {
        return false;
    }

    liveSocket.onopen = () => {
        liveMode = true;
        const statusText = document.getElementById('statusText');
        if (statusText) statusText.textContent = 'Connected';
        const connPill = document.getElementById('connPill');
        if (connPill) connPill.textContent = 'Connected';
        const statusDot = document.getElementById('statusDot');
        if (statusDot) statusDot.classList.add('running');
    };

    liveSocket.onmessage = (evt) => {
        const data = safeJsonParse(evt.data);
        if (!data) return;

        if (data.type === "hello") {
            liveProductId = data.product_id || liveProductId;
            const productPill = document.getElementById("productPill");
            const chartSymbol = document.getElementById("chartSymbol");
            const obSymbol = document.getElementById("obSymbol");
            const tradesSymbol = document.getElementById("tradesSymbol");
            if (productPill) productPill.textContent = liveProductId;
            if (chartSymbol) chartSymbol.textContent = liveProductId;
            if (obSymbol) obSymbol.textContent = liveProductId;
            if (tradesSymbol) tradesSymbol.textContent = liveProductId;
            return;
        }

        if (data.type === "coinbase") {
            if (data.channel === "level2") applyCoinbaseLevel2(data);
            if (data.channel === "market_trades") applyCoinbaseTrades(data);
            if (data.channel === "ticker") applyCoinbaseTicker(data);

            // Update UI from live state
            const { spread, mid } = computeDepthArraysFromMaps(10);
            updateTerminalUI({ spread, mid });
        }
    };

    liveSocket.onclose = () => {
        liveMode = false;
        liveSocket = null;
        const statusText = document.getElementById('statusText');
        if (statusText) statusText.textContent = 'Disconnected';
        const connPill = document.getElementById('connPill');
        if (connPill) connPill.textContent = 'Disconnected';
        const statusDot = document.getElementById('statusDot');
        if (statusDot) statusDot.classList.remove('running');
    };

    liveSocket.onerror = () => {
        // If localhost ws is not running, fall back to simulation.
    };

    return true;
}

function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
}

function updateTerminalUI({ spread, mid }) {
    updateOrderbookPanel({ spread, mid });
    updateTradesPanel();
    updateStatsPanel({ mid });
    drawPriceChart();

    const midText = document.getElementById("midText");
    const spreadText = document.getElementById("spreadText");
    const vol24hText = document.getElementById("vol24hText");
    if (midText) midText.textContent = `Mid: ${mid ? `$${mid.toFixed(2)}` : "—"}`;
    if (spreadText) spreadText.textContent = `Spr: ${spread ? `$${spread.toFixed(2)}` : "—"}`;
    if (vol24hText) vol24hText.textContent = `Vol: ${metrics.volume24h === null ? "—" : fmtCompact(metrics.volume24h)}`;

    const lastUpdate = document.getElementById("lastUpdate");
    if (lastUpdate) lastUpdate.textContent = `LIVE · ${new Date().toLocaleTimeString()}`;
}

function startSimulation() {
    if (running) return;
    if (liveMode) return; // live mode is continuous; no start/stop needed
    running = true;
    simulator.startTime = Date.now();
    simulator.eventCount = 0;
    
    document.getElementById('statusText').textContent = 'Running';
    const statusDot = document.getElementById('statusDot');
    if (statusDot) statusDot.classList.add('running');
    document.querySelectorAll('.pipeline-stage').forEach(stage => stage.classList.add('active'));
    
    simulationInterval = setInterval(() => {
        // Generate and process event
        const event = simulator.generateMarketEvent();
        simulator.updateOrderBook(event);
        
        // Update metrics
        const { spread, mid } = simulator.calculateMetrics();
        
        // Update UI
        updateOrderBookUI();
        updateMetricsUI(spread, mid);
        updateTradesUI();
        drawChart();
        
        // Animate pipeline stages randomly
        document.querySelectorAll('.pipeline-stage').forEach((stage, i) => {
            if (Math.random() > 0.7) {
                stage.style.transform = 'scale(1.05)';
                setTimeout(() => stage.style.transform = 'scale(1)', 100);
            }
        });
    }, 100); // 10 events per second for demo
}

function stopSimulation() {
    if (liveMode) return;
    running = false;
    clearInterval(simulationInterval);
    document.getElementById('statusText').textContent = 'Stopped';
    const statusDot = document.getElementById('statusDot');
    if (statusDot) statusDot.classList.remove('running');
    document.querySelectorAll('.pipeline-stage').forEach(stage => stage.classList.remove('active'));
}

function updateOrderbookPanel({ spread, mid }) {
    const obPrice = document.getElementById("obPrice");
    if (obPrice) obPrice.textContent = mid ? `$${mid.toFixed(2)}` : "—";

    const rowsEl = document.getElementById("orderbookRows");
    if (!rowsEl) return;

    const levels = 24;
    const bids = orderBook.bids.slice(0, levels).map(l => ({ price: l.price / 100, size: Number(l.size) || 0 }));
    const asks = orderBook.asks.slice(0, levels).map(l => ({ price: l.price / 100, size: Number(l.size) || 0 }));

    // Render asks on top (highest -> lowest visually), then a mid line, then bids.
    const asksTop = [...asks].reverse();
    const maxAsk = Math.max(1, ...asks.map(a => a.size));
    const maxBid = Math.max(1, ...bids.map(b => b.size));

    let html = "";
    for (const a of asksTop) {
        const w = Math.min(100, (a.size / maxAsk) * 100).toFixed(0);
        html += `<div class="ob-row ask" style="--w:${w}%"><div class="p">$${a.price.toFixed(2)}</div><div class="s right">${fmtSize(a.size)}</div></div>`;
    }

    if (mid) {
        html += `<div class="ob-row midline" style="--w:0%"><div class="p">$${mid.toFixed(2)}</div><div class="s right">${spread ? `spr ${spread.toFixed(2)}` : ""}</div></div>`;
    }

    for (const b of bids) {
        const w = Math.min(100, (b.size / maxBid) * 100).toFixed(0);
        html += `<div class="ob-row bid" style="--w:${w}%"><div class="p">$${b.price.toFixed(2)}</div><div class="s right">${fmtSize(b.size)}</div></div>`;
    }

    rowsEl.innerHTML = html;

    const volSummary = document.getElementById("volSummary");
    if (volSummary) volSummary.textContent = `24h vol: ${metrics.volume24h === null ? "—" : fmtCompact(metrics.volume24h)}`;
}

function updateTradesPanel() {
    const table = document.getElementById("tradesTable");
    if (!table) return;

    const lastN = trades.slice(0, 18);
    const exch = "CB";

    table.innerHTML = lastN
        .map((t) => {
            const cls = t.side === "B" ? "green" : "red";
            const value = Number(t.price) * Number(t.quantity);
            return `<div class="trow">
                <div>${t.time}</div>
                <div class="amber">${exch}</div>
                <div class="right ${cls}">${Number(t.price).toFixed(2)}</div>
                <div class="right">${fmtSize(t.quantity)}</div>
                <div class="right amber">$${fmtCompact(value)}</div>
                <div class="right ${cls}">${t.side}</div>
            </div>`;
        })
        .join("");

    const tradeCount = document.getElementById("tradeCount");
    if (tradeCount) tradeCount.textContent = `${trades.length} trades`;

    // Buy vs sell split from recent prints
    const sample = recentPrints.slice(0, 200);
    const buyQty = sample.filter(p => p.side === "B").reduce((a, b) => a + (b.qty || 0), 0);
    const sellQty = sample.filter(p => p.side === "S").reduce((a, b) => a + (b.qty || 0), 0);
    const total = buyQty + sellQty;
    const buyPct = total ? Math.round((buyQty / total) * 100) : 0;
    const sellPct = total ? 100 - buyPct : 0;

    const buyPctEl = document.getElementById("buyPct");
    const sellPctEl = document.getElementById("sellPct");
    if (buyPctEl) buyPctEl.textContent = `${buyPct}%`;
    if (sellPctEl) sellPctEl.textContent = `${sellPct}%`;

    const tradeBuyBar = document.getElementById("tradeBuyBar");
    const tradeSellBar = document.getElementById("tradeSellBar");
    if (tradeBuyBar) tradeBuyBar.style.width = `${buyPct}%`;
    if (tradeSellBar) tradeSellBar.style.width = `${sellPct}%`;
}

function updateStatsPanel({ mid }) {
    const table = document.getElementById("statsTable");
    if (!table) return;

    const { bid: bid2, ask: ask2 } = computeDepthSums(mid, 0.02);
    const { bid: bid10, ask: ask10 } = computeDepthSums(mid, 0.1);
    const d2 = bid2 - ask2;
    const d10 = bid10 - ask10;

    table.innerHTML = `<div class="trow">
        <div class="amber">Coinbase</div>
        <div class="right">${mid ? mid.toFixed(2) : "—"}</div>
        <div class="right green">${fmtCompact(bid2)}</div>
        <div class="right red">${fmtCompact(ask2)}</div>
        <div class="right ${d2 >= 0 ? "green" : "red"}">${d2 >= 0 ? "+" : ""}${fmtCompact(d2)}</div>
        <div class="right green">${fmtCompact(bid10)}</div>
        <div class="right red">${fmtCompact(ask10)}</div>
        <div class="right ${d10 >= 0 ? "green" : "red"}">${d10 >= 0 ? "+" : ""}${fmtCompact(d10)}</div>
    </div>`;
}

function drawPriceChart() {
    const canvas = document.getElementById("priceChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(2, Math.floor(rect.width * window.devicePixelRatio));
    canvas.height = Math.max(2, Math.floor(rect.height * window.devicePixelRatio));
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const prices = recentPrices.slice(-240);
    if (prices.length < 2) return;

    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;

    // Line
    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.85)";

    for (let i = 0; i < prices.length; i++) {
        const x = (i / (prices.length - 1)) * (w - 20) + 10;
        const y = h - 28 - ((prices[i] - minP) / range) * (h - 60);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Volume bars from recent prints
    const prints = recentPrints.slice(0, 120).reverse();
    const vols = prints.map(p => p.qty || 0);
    const maxV = Math.max(1, ...vols);

    const baseY = h - 10;
    const barHMax = 18;
    for (let i = 0; i < prints.length; i++) {
        const p = prints[i];
        const x = (i / (prints.length - 1)) * (w - 20) + 10;
        const bh = Math.max(1, (p.qty / maxV) * barHMax);
        ctx.strokeStyle = p.side === "B" ? "rgba(34,197,94,0.65)" : "rgba(239,68,68,0.65)";
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, baseY - bh);
        ctx.stroke();
    }
}

// Initialize
connectLive();
window.addEventListener("resize", () => {
    if (liveMode) drawPriceChart();
});
