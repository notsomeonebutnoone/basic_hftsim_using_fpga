# FPGA-Based HFT System (Software Simulation)

A learning project demonstrating High-Frequency Trading concepts using FPGA-style architecture, implemented entirely in software.

## 🎯 Goal

Build an HFT system that *thinks like an FPGA* without requiring actual hardware. Learn:
- Market data feed parsing at line rate
- Order book management
- Low-latency trading strategies
- Pipeline architecture (FPGA-style parallelism)
- Latency measurement and optimization

## 🏗️ Architecture

```
┌─────────────────┐
│  Market Data    │ ← Simulated exchange feed (ITCH/OUCH protocol)
│  Feed Parser    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Order Book    │ ← Maintains bid/ask queues in memory
│   Manager       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Trading Logic  │ ← Strategy engine (market making, arbitrage)
│  (FPGA Pipeline)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Order Executor │ ← Sends orders (simulated)
└─────────────────┘
```

## 📁 Project Structure

```
hft-fpga-project/
├── README.md
├── docs/
│   ├── architecture.md
│   ├── protocols.md
│   └── latency-budget.md
├── src/
│   ├── feed_parser/      # Market data feed parsing
│   ├── order_book/       # Order book management
│   ├── strategy/         # Trading strategies
│   ├── executor/         # Order execution
│   └── metrics/          # Latency tracking
├── fpga/
│   ├── verilog/          # Actual FPGA code (for synthesis later)
│   ├── testbenches/      # Simulation testbenches
│   └── constraints/      # Timing constraints
├── simulations/
│   ├── market_scenarios/ # Pre-recorded market data
│   └── backtests/        # Strategy backtesting
├── tests/
└── scripts/
```

## 🚀 Getting Started

### Prerequisites
```bash
# Python dependencies
pip install numpy pandas asyncio websockets aiohttp sortedcontainers

# FPGA simulation (optional)
pip install myhdl cocotb

# Verilog simulator
sudo apt install iverilog  # Icarus Verilog
```

### Run CLI Simulation
```bash
cd hft-fpga-project
python src/main.py --events=1000
```

### Run Live Web Demo
```bash
npm install
npm run dev
# Open http://localhost:8080
```

### Connect to Live Exchange (Binance)
```bash
python src/live_feed/binance_connector.py
# Streams real BTC/USDT order book
```

### Run Backtest
```bash
python src/backtest/backtester.py
```

## 📊 Features

- ✅ **Simulated Market Feed**: Replay historical data or connect to crypto testnet
- ✅ **Order Book**: Full L2/L3 order book management
- ✅ **FPGA-Style Pipeline**: Parallel processing architecture
- ✅ **Latency Tracking**: Measure every stage of the trading pipeline
- ✅ **Strategy Engine**: Pluggable trading strategies (market making)
- ✅ **Backtesting**: Test strategies against historical data
- ✅ **Live Web Demo**: Real-time visualization with WebSocket streaming
- ✅ **Exchange Integration**: Connect to Binance/Coinbase live feeds
- ✅ **Verilog FPGA Code**: Synthesizable modules for actual hardware

## 🧠 What You'll Learn

1. **Market Microstructure**: How exchanges actually work
2. **Protocol Parsing**: ITCH, OUCH, FIX protocols
3. **Low-Latency Design**: Memory layouts, cache optimization
4. **FPGA Concepts**: Pipelining, parallelism, timing constraints
5. **Trading Strategies**: Market making, statistical arbitrage

## 📈 Performance Goals

| Metric | Target | Notes |
|--------|--------|-------|
| Feed parse latency | < 1 μs | Software simulation |
| Order book update | < 500 ns | In-memory operations |
| Strategy decision | < 2 μs | Simple logic |
| Total round-trip | < 10 μs | End-to-end |

*Note: Real FPGA systems achieve < 100ns total. This is a learning tool.*

## 🔮 Future Extensions

- [ ] Synthesize for actual FPGA (Xilinx/Intel)
- [ ] Connect to real exchange testnet (Binance, Alpaca)
- [ ] Implement TCP/UDP stack in Verilog
- [ ] Add ML-based prediction layer
- [ ] Multi-exchange arbitrage

## 📚 Resources

- [ITCH Protocol Specification](https://www.nasdaqtrader.com/content/technicalsupport/specifications/dataproducts/NQTVITCHspecification.pdf)
- [FPGA for HFT (Academic Paper)](https://arxiv.org/abs/1807.06188)
- [High-Frequency Trading (Book)](https://www.amazon.com/High-Frequency-Trading-Practical-Tools-Strategies/dp/0071823077)

## ⚠️ Disclaimer

This is a **learning project only**. Do not use for actual trading without extensive testing, risk management, and regulatory compliance. HFT involves significant financial risk.

## 📄 License

MIT License
