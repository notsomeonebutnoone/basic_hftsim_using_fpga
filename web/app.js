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
            trades.unshift({
                id: tr.trade_id || String(Date.now()),
                price: Number(tr.price),
                quantity: Number(tr.size),
                side: tr.side === "BUY" ? "B" : "S",
                time: new Date(tr.time).toLocaleTimeString(),
            });
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
        document.getElementById('statusText').textContent = 'Live';
        const statusDot = document.getElementById('statusDot');
        if (statusDot) statusDot.classList.add('running');
        document.querySelectorAll('.pipeline-stage').forEach(stage => stage.classList.add('active'));
    };

    liveSocket.onmessage = (evt) => {
        const data = safeJsonParse(evt.data);
        if (!data) return;

        if (data.type === "hello") {
            liveProductId = data.product_id || liveProductId;
            return;
        }

        if (data.type === "coinbase") {
            if (data.channel === "level2") applyCoinbaseLevel2(data);
            if (data.channel === "market_trades") applyCoinbaseTrades(data);
            if (data.channel === "ticker") applyCoinbaseTicker(data);

            // Update UI from live state
            const { spread, mid } = computeDepthArraysFromMaps(10);
            updateOrderBookUI(true);
            updateMetricsUI(spread, mid, true);
            updateTradesUI(true);
            drawChart();
        }
    };

    liveSocket.onclose = () => {
        liveMode = false;
        liveSocket = null;
        document.getElementById('statusText').textContent = 'Disconnected';
        const statusDot = document.getElementById('statusDot');
        if (statusDot) statusDot.classList.remove('running');
        document.querySelectorAll('.pipeline-stage').forEach(stage => stage.classList.remove('active'));
    };

    liveSocket.onerror = () => {
        // If localhost ws is not running, fall back to simulation.
    };

    return true;
}

function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
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

function updateOrderBookUI(isLive = false) {
    const asksBody = document.getElementById('asksBody');
    const bidsBody = document.getElementById('bidsBody');

    const maxAsk = Math.max(1, ...orderBook.asks.slice(0, 5).map(l => Number(l.size) || 0));
    const maxBid = Math.max(1, ...orderBook.bids.slice(0, 5).map(l => Number(l.size) || 0));
    
    asksBody.innerHTML = orderBook.asks.slice(0, 5).reverse().map(level => `
        <tr class="ask-row">
            <td class="ask-price">$${(level.price / 100).toFixed(2)}</td>
            <td class="depth-cell" style="--depth:${Math.min(100, ((Number(level.size)||0) / maxAsk) * 100).toFixed(0)}%"><span>${fmtSize(level.size)}</span></td>
            <td>${level.orders}</td>
        </tr>
    `).join('');
    
    bidsBody.innerHTML = orderBook.bids.slice(0, 5).map(level => `
        <tr class="bid-row">
            <td class="bid-price">$${(level.price / 100).toFixed(2)}</td>
            <td class="depth-cell" style="--depth:${Math.min(100, ((Number(level.size)||0) / maxBid) * 100).toFixed(0)}%"><span>${fmtSize(level.size)}</span></td>
            <td>${level.orders}</td>
        </tr>
    `).join('');
}

function updateMetricsUI(spread, mid, isLive = false) {
    document.getElementById('spread').textContent = `$${spread.toFixed(2)}`;
    document.getElementById('midPrice').textContent = `$${mid.toFixed(2)}`;
    document.getElementById('latency').textContent = isLive ? "—" : simulator.calculateMetrics().latency;
    document.getElementById('throughput').textContent = isLive ? liveProductId : metrics.throughput;
    document.getElementById('volume24h').textContent = metrics.volume24h === null ? "—" : fmtNumber(metrics.volume24h, 4);
    document.getElementById('pnl').textContent = `$${metrics.pnl.toFixed(2)}`;
    document.getElementById('position').textContent = metrics.position;
}

function updateTradesUI(isLive = false) {
    const tradesList = document.getElementById('tradesList');
    tradesList.innerHTML = trades.map(trade => `
        <div class="trade-item">
            <span class="${trade.side === 'B' ? 'trade-buy' : 'trade-sell'}">
                ${trade.side === 'B' ? 'BUY' : 'SELL'}
            </span>
            <span>$${Number(trade.price).toFixed(2)} x ${fmtSize(trade.quantity)}</span>
            <span style="color: #666">${trade.time}</span>
        </div>
    `).join('');
}

function drawChart() {
    const canvas = document.getElementById('pnlChart');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (pnlHistory.length < 2) return;
    
    const maxPnl = Math.max(...pnlHistory, 1);
    const minPnl = Math.min(...pnlHistory, -1);
    const range = maxPnl - minPnl || 1;
    
    ctx.beginPath();
    ctx.strokeStyle = '#00d9ff';
    ctx.lineWidth = 2;
    
    pnlHistory.forEach((pnl, i) => {
        const x = (i / (pnlHistory.length - 1)) * canvas.width;
        const y = canvas.height - ((pnl - minPnl) / range) * canvas.height;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    
    ctx.stroke();
    
    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(0, 217, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 217, 255, 0)');
    
    ctx.lineTo(canvas.width, canvas.height);
    ctx.lineTo(0, canvas.height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
}

// Initialize
connectLive();
updateOrderBookUI();
updateMetricsUI(0, 150);
