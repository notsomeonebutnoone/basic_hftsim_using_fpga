# 🚀 Quick Start Guide

## 1️⃣ Run the CLI Simulation (Fastest)

```bash
cd hft-fpga-project
python src/main.py --events=500
```

**You'll see:**
- Real-time order book updates
- Latency metrics (nanoseconds)
- P&L tracking
- Throughput stats

---

## 2️⃣ Launch the Live Web Demo 🌐

```bash
cd hft-fpga-project
npm install
npm run dev
```

Then open: **http://localhost:8080**

**Features:**
- 📊 Live order book visualization (bids/asks updating in real-time)
- ⚡ Latency dashboard with charts
- 💹 Live trade feed
- 🔧 Animated FPGA pipeline showing data flow
- ▶️ Start/Stop controls

---

## 3️⃣ Connect to Live Crypto Data (Binance)

```bash
pip install websockets aiohttp
python src/live_feed/binance_connector.py
```

**Streams real BTC/USDT order book from Binance!**

---

## 4️⃣ Run Backtests

```bash
python src/backtest/backtester.py
```

Tests strategies on historical data with Sharpe ratio, drawdown analysis.

---

## 5️⃣ Synthesize FPGA Code (Advanced)

```bash
# Install Icarus Verilog
sudo apt install iverilog

# Simulate Verilog module
iverilog -o testbench fpga/verilog/order_book.v fpga/testbenches/order_book_tb.v
vvp testbench
```

---

## 🎯 What Each Component Does

| Component | Purpose | Language |
|-----------|---------|----------|
| `src/main.py` | Full HFT pipeline simulation | Python |
| `web/` | Live interactive demo | HTML/JS + Python WebSocket |
| `src/live_feed/` | Real exchange connector | Python + WebSocket |
| `src/backtest/` | Historical strategy testing | Python |
| `fpga/verilog/` | Actual FPGA code for synthesis | Verilog |

---

## 📈 Example Output

```
🚀 Starting HFT Pipeline Simulation
   Symbol: AAPL
   Events: 1000
   Rate: 100000/sec

============================================================
📊 SIMULATION RESULTS
============================================================

⚡ Throughput:
   Total Events:     1,000
   Elapsed Time:     0.15s
   Events/Second:    6,667

⏱️  Pipeline Latency:
   Average:          342 ns (0.34 μs)
   Min:              198 ns
   Max:              892 ns
   P99:              654 ns

🔧 Component Stats:
   Feed Parser:      1000 messages, 312ns avg
   Order Book:       847 orders, 823 adds, 24 cancels
   Strategy:         412 quotes, 82 trades
   P&L:              $234.50
   Position:         150 shares
```

---

## ❓ Troubleshooting

**Web server won't start?**
```bash
pip install aiohttp
```

**Import errors?**
```bash
pip install -r requirements.txt
```

**Port 8080 in use?**
Edit `web/server.py` and change `port=8080` to another port.

---

Ready? Let's go! 🚀
