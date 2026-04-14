"""
Backtesting Engine
Test strategies against historical data
"""

import time
from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import datetime
import json


@dataclass
class Trade:
    timestamp: datetime
    symbol: str
    side: str
    price: float
    quantity: int
    pnl: float


@dataclass
class BacktestResult:
    total_return: float
    sharpe_ratio: float
    max_drawdown: float
    total_trades: int
    win_rate: float
    avg_trade_pnl: float
    trades: List[Trade]


class Backtester:
    """Run strategies against historical data"""
    
    def __init__(self, initial_capital: float = 100000):
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.position = 0
        self.trades: List[Trade] = []
        self.equity_curve: List[float] = []
        self.pnl_history: List[float] = []
    
    def run(self, strategy, historical_data: List[Dict]) -> BacktestResult:
        """Run backtest on historical data"""
        self.capital = self.initial_capital
        self.position = 0
        self.trades = []
        self.equity_curve = [self.initial_capital]
        self.pnl_history = [0]
        
        for bar in historical_data:
            # Get strategy signal
            signal = strategy.on_bar(bar)
            
            # Execute trade
            if signal and self.position == 0 and signal == 'BUY':
                self._execute_trade(bar['close'], bar['volume'], 'BUY')
            elif signal and self.position > 0 and signal == 'SELL':
                self._execute_trade(bar['close'], self.position, 'SELL')
            
            # Update equity
            unrealized_pnl = self.position * (bar['close'] - self._avg_entry_price())
            total_equity = self.capital + unrealized_pnl
            self.equity_curve.append(total_equity)
            self.pnl_history.append(unrealized_pnl)
        
        return self._calculate_metrics()
    
    def _execute_trade(self, price: float, quantity: int, side: str):
        """Execute a trade"""
        if side == 'BUY':
            cost = price * quantity
            if cost > self.capital:
                quantity = int(self.capital / price)
                cost = price * quantity
            self.capital -= cost
            self.position += quantity
        else:  # SELL
            revenue = price * min(quantity, self.position)
            self.capital += revenue
            self.position -= min(quantity, self.position)
        
        pnl = revenue - cost if side == 'SELL' else 0
        self.trades.append(Trade(
            timestamp=datetime.now(),
            symbol='AAPL',
            side=side,
            price=price,
            quantity=quantity,
            pnl=pnl
        ))
    
    def _avg_entry_price(self) -> float:
        """Calculate average entry price"""
        if not self.trades or self.position == 0:
            return 0
        buys = [t for t in self.trades if t.side == 'BUY']
        if not buys:
            return 0
        total_cost = sum(t.price * t.quantity for t in buys)
        total_qty = sum(t.quantity for t in buys)
        return total_cost / total_qty if total_qty > 0 else 0
    
    def _calculate_metrics(self) -> BacktestResult:
        """Calculate performance metrics"""
        if not self.trades:
            return BacktestResult(0, 0, 0, 0, 0, 0, [])
        
        total_return = (self.equity_curve[-1] - self.initial_capital) / self.initial_capital
        
        # Sharpe ratio (simplified)
        returns = [self.equity_curve[i+1]/self.equity_curve[i]-1 
                  for i in range(len(self.equity_curve)-1)]
        avg_return = sum(returns) / len(returns) if returns else 0
        std_return = (sum((r - avg_return)**2 for r in returns) / len(returns))**0.5 if len(returns) > 1 else 1
        sharpe = (avg_return / std_return) * (252**0.5) if std_return > 0 else 0
        
        # Max drawdown
        peak = self.equity_curve[0]
        max_dd = 0
        for equity in self.equity_curve:
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak
            if dd > max_dd:
                max_dd = dd
        
        # Win rate
        winning_trades = [t for t in self.trades if t.pnl > 0]
        win_rate = len(winning_trades) / len(self.trades) if self.trades else 0
        
        # Avg PnL
        avg_pnl = sum(t.pnl for t in self.trades) / len(self.trades) if self.trades else 0
        
        return BacktestResult(
            total_return=total_return,
            sharpe_ratio=sharpe,
            max_drawdown=max_dd,
            total_trades=len(self.trades),
            win_rate=win_rate,
            avg_trade_pnl=avg_pnl,
            trades=self.trades
        )


if __name__ == '__main__':
    # Test with sample data
    import random
    data = [{'close': 150 + random.uniform(-5, 5), 'volume': 1000} for _ in range(100)]
    
    class SimpleStrategy:
        def on_bar(self, bar):
            if bar['close'] < 148:
                return 'BUY'
            elif bar['close'] > 152:
                return 'SELL'
            return None
    
    backtester = Backtester()
    result = backtester.run(SimpleStrategy(), data)
    
    print(f"Return: {result.total_return:.2%}")
    print(f"Sharpe: {result.sharpe_ratio:.2f}")
    print(f"Trades: {result.total_trades}")
    print(f"Win Rate: {result.win_rate:.2%}")
