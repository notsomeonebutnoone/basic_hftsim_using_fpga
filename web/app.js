// HFT FPGA Simulator - Live Demo
let running = false;
let simulationInterval;
let orderBook = { bids: [], asks: [] };
let metrics = { latency: 0, throughput: 0, pnl: 0, position: 0 };
let trades = [];
let pnlHistory = [];

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

function startSimulation() {
    if (running) return;
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
    running = false;
    clearInterval(simulationInterval);
    document.getElementById('statusText').textContent = 'Stopped';
    const statusDot = document.getElementById('statusDot');
    if (statusDot) statusDot.classList.remove('running');
    document.querySelectorAll('.pipeline-stage').forEach(stage => stage.classList.remove('active'));
}

function updateOrderBookUI() {
    const asksBody = document.getElementById('asksBody');
    const bidsBody = document.getElementById('bidsBody');
    
    asksBody.innerHTML = orderBook.asks.slice(0, 5).reverse().map(level => `
        <tr class="ask-row">
            <td class="ask-price">$${(level.price / 100).toFixed(2)}</td>
            <td>${level.size}</td>
            <td>${level.orders}</td>
        </tr>
    `).join('');
    
    bidsBody.innerHTML = orderBook.bids.slice(0, 5).map(level => `
        <tr class="bid-row">
            <td class="bid-price">$${(level.price / 100).toFixed(2)}</td>
            <td>${level.size}</td>
            <td>${level.orders}</td>
        </tr>
    `).join('');
}

function updateMetricsUI(spread, mid) {
    document.getElementById('spread').textContent = `$${spread.toFixed(2)}`;
    document.getElementById('midPrice').textContent = `$${mid.toFixed(2)}`;
    document.getElementById('latency').textContent = simulator.calculateMetrics().latency;
    document.getElementById('throughput').textContent = metrics.throughput;
    document.getElementById('pnl').textContent = `$${metrics.pnl.toFixed(2)}`;
    document.getElementById('position').textContent = metrics.position;
}

function updateTradesUI() {
    const tradesList = document.getElementById('tradesList');
    tradesList.innerHTML = trades.map(trade => `
        <div class="trade-item">
            <span class="${trade.side === 'B' ? 'trade-buy' : 'trade-sell'}">
                ${trade.side === 'B' ? 'BUY' : 'SELL'}
            </span>
            <span>$${trade.price.toFixed(2)} x ${trade.quantity}</span>
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
updateOrderBookUI();
updateMetricsUI(0, 150);
