"""
Market Making Strategy
FPGA-style pipeline: quote generation → risk check → order submission
"""

import time
from dataclasses import dataclass
from typing import Optional, Dict, List, Callable
from enum import Enum


class Signal(Enum):
    BUY = 1
    SELL = -1
    HOLD = 0


@dataclass
class TradingSignal:
    """Output from strategy pipeline"""
    timestamp_ns: int
    symbol: str
    signal: Signal
    confidence: float  # 0.0 to 1.0
    target_price: int
    target_qty: int
    reason: str


@dataclass
class RiskMetrics:
    """Current risk state"""
    position: int  # Net position (positive = long)
    unrealized_pnl: int
    realized_pnl: int
    exposure: int  # Total absolute position
    var_limit: int  # Value-at-risk limit
    daily_loss_limit: int
    daily_loss: int


class MarketMaker:
    """
    Simple market making strategy with FPGA-style pipeline.
    
    Pipeline stages:
    1. Spread Calculator → Determine bid/ask prices
    2. Inventory Manager → Adjust quotes based on position
    3. Risk Checker → Validate against limits
    4. Order Generator → Create executable orders
    """
    
    def __init__(self, symbol: str, initial_spread: int = 10, position_limit: int = 1000):
        self.symbol = symbol
        self.initial_spread = spread = initial_spread  # In cents
        self.position_limit = position_limit
        
        # State
        self.position = 0  # Net position
        self.inventory_skew = 0  # Adjust quotes based on inventory
        self.last_mid_price: Optional[int] = None
        self.trade_count = 0
        self.pnl = 0
        self.daily_pnl = 0
        
        # Pipeline latency tracking
        self.pipeline_latencies: List[int] = []
        
        # Callbacks
        self.order_handlers: List[Callable] = []
        self.signal_handlers: List[Callable] = []
        
        # Stats
        self.stats = {
            'quotes_generated': 0,
            'trades_executed': 0,
            'signals_sent': 0,
            'risk_rejects': 0
        }
    
    def on_order_book_update(self, book_data: Dict):
        """
        Called when order book updates (from previous pipeline stage).
        Generates new quotes based on market state.
        """
        start_ns = time.perf_counter_ns()
        
        mid_price = book_data.get('mid_price')
        if not mid_price:
            return
        
        mid_price = int(mid_price)
        self.last_mid_price = mid_price
        
        # Stage 1: Calculate base quotes
        half_spread = self.initial_spread // 2
        base_bid = mid_price - half_spread
        base_ask = mid_price + half_spread
        
        # Stage 2: Inventory skew (avoid accumulating too much one side)
        inventory_factor = 0.0
        if self.position != 0:
            # Skew quotes to reduce position
            inventory_factor = min(abs(self.position) / self.position_limit, 0.5)
            if self.position > 0:  # Long → lower bid/ask to sell
                self.inventory_skew = int(self.initial_spread * inventory_factor)
                base_bid -= self.inventory_skew
                base_ask -= self.inventory_skew
            else:  # Short → raise bid/ask to buy
                self.inventory_skew = int(self.initial_spread * inventory_factor)
                base_bid += self.inventory_skew
                base_ask += self.inventory_skew
        
        # Stage 3: Risk check
        risk_ok = self._check_risk(base_bid, base_ask)
        if not risk_ok:
            self.stats['risk_rejects'] += 1
            return
        
        # Stage 4: Generate quotes
        quote = {
            'symbol': self.symbol,
            'bid_price': base_bid,
            'ask_price': base_ask,
            'bid_qty': 100,
            'ask_qty': 100,
            'timestamp_ns': time.time_ns(),
            'mid_price': mid_price,
            'spread': base_ask - base_bid,
            'position': self.position,
            'inventory_skew': self.inventory_skew
        }
        
        self.stats['quotes_generated'] += 1
        
        # Notify order generator (next pipeline stage)
        for handler in self.order_handlers:
            handler(quote)
        
        end_ns = time.perf_counter_ns()
        self.pipeline_latencies.append(end_ns - start_ns)
    
    def on_trade(self, price: int, quantity: int, side: str):
        """Called when a quote gets executed"""
        self.trade_count += 1
        
        if side == 'B':  # We bought
            self.position += quantity
            self.pnl -= price * quantity
        else:  # We sold
            self.position -= quantity
            self.pnl += price * quantity
        
        self.stats['trades_executed'] += 1
        
        # Generate trading signal
        signal = self._generate_signal(price, quantity, side)
        for handler in self.signal_handlers:
            handler(signal)
        
        self.stats['signals_sent'] += 1
    
    def _check_risk(self, bid: int, ask: int) -> bool:
        """Simple risk checks"""
        # Check position limit
        if abs(self.position) >= self.position_limit:
            return False
        
        # Check daily loss limit (simplified)
        if self.daily_pnl < -100000:  # $1000 loss limit
            return False
        
        return True
    
    def _generate_signal(self, price: int, quantity: int, side: str) -> TradingSignal:
        """Generate trading signal based on trade"""
        # Simple momentum signal (for demo)
        if self.last_mid_price:
            price_change = price - self.last_mid_price
            if price_change > 5:  # Price moving up
                signal = Signal.BUY
                reason = "Momentum up"
            elif price_change < -5:
                signal = Signal.SELL
                reason = "Momentum down"
            else:
                signal = Signal.HOLD
                reason = "No clear signal"
        else:
            signal = Signal.HOLD
            reason = "Insufficient data"
        
        return TradingSignal(
            timestamp_ns=time.time_ns(),
            symbol=self.symbol,
            signal=signal,
            confidence=0.5,
            target_price=price,
            target_qty=quantity,
            reason=reason
        )
    
    def register_order_handler(self, handler: Callable):
        """Register handler for generated quotes"""
        self.order_handlers.append(handler)
    
    def register_signal_handler(self, handler: Callable):
        """Register handler for trading signals"""
        self.signal_handlers.append(handler)
    
    def get_stats(self) -> Dict:
        """Return strategy statistics"""
        avg_latency = sum(self.pipeline_latencies) / len(self.pipeline_latencies) if self.pipeline_latencies else 0
        return {
            **self.stats,
            'position': self.position,
            'pnl': self.pnl,
            'daily_pnl': self.daily_pnl,
            'avg_pipeline_latency_ns': avg_latency,
            'current_spread': self.initial_spread,
            'inventory_skew': self.inventory_skew
        }
    
    def reset_daily(self):
        """Reset daily counters"""
        self.daily_pnl = 0
        self.pipeline_latencies.clear()


if __name__ == '__main__':
    # Test the market maker
    mm = MarketMaker('AAPL', initial_spread=10, position_limit=500)
    
    def on_quote(quote):
        print(f"Quote: BID ${quote['bid_price']/100:.2f} x {quote['bid_qty']} | "
              f"ASK ${quote['ask_price']/100:.2f} x {quote['ask_qty']} | "
              f"Pos: {quote['position']} | Skew: {quote['inventory_skew']}")
    
    def on_signal(signal: TradingSignal):
        print(f"Signal: {signal.signal.name} | {signal.reason}")
    
    mm.register_order_handler(on_quote)
    mm.register_signal_handler(on_signal)
    
    # Simulate order book updates
    print("Simulating market maker...")
    for i in range(10):
        mid_price = 15000 + i * 5  # Price moving up
        mm.on_order_book_update({
            'mid_price': mid_price,
            'spread': 10,
            'bids': [],
            'asks': []
        })
        
        # Simulate a trade every 3 updates
        if i % 3 == 0:
            mm.on_trade(price=mid_price, quantity=50, side='B')
    
    print(f"\nStats: {mm.get_stats()}")
