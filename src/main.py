#!/usr/bin/env python3
"""
HFT FPGA Simulation - Main Entry Point
Pipelines all components: Feed → Order Book → Strategy → Execution
"""

import time
import argparse
from typing import List, Dict
from collections import deque

# Import components
from feed_parser.feed_parser import FeedParser, MarketEvent, create_test_message, MessageType
from order_book.order_book import OrderBook, Order
from strategy.market_maker import MarketMaker


class ExecutionEngine:
    """Simulates order execution with latency"""
    
    def __init__(self):
        self.fills: List[Dict] = []
        self.latencies: List[int] = []
    
    def submit_order(self, order_data: Dict) -> Dict:
        """Submit order and simulate fill"""
        start_ns = time.perf_counter_ns()
        
        # Simulate execution latency (50-200 μs in software)
        time.sleep(0.0001)  # 100 μs
        
        fill = {
            'order_id': order_data.get('order_id', 0),
            'symbol': order_data['symbol'],
            'price': order_data['price'],
            'quantity': order_data['quantity'],
            'side': order_data['side'],
            'timestamp_ns': time.time_ns(),
            'status': 'FILLED'
        }
        
        end_ns = time.perf_counter_ns()
        self.latencies.append(end_ns - start_ns)
        self.fills.append(fill)
        
        return fill
    
    def get_stats(self) -> Dict:
        avg_latency = sum(self.latencies) / len(self.latencies) if self.latencies else 0
        return {
            'total_fills': len(self.fills),
            'avg_execution_latency_ns': avg_latency,
            'fills': self.fills[-5:]  # Last 5 fills
        }


class HFTPipeline:
    """
    Complete HFT pipeline simulating FPGA architecture.
    
    Data flows through stages:
    Feed Parser → Order Book → Strategy → Execution
    """
    
    def __init__(self, symbol: str = 'AAPL'):
        self.symbol = symbol
        
        # Initialize pipeline stages
        self.feed_parser = FeedParser()
        self.order_book = OrderBook(symbol)
        self.strategy = MarketMaker(symbol)
        self.executor = ExecutionEngine()
        
        # Connect pipeline stages
        self.feed_parser.register_handler(self._on_market_event)
        self.order_book.register_handler(self._on_order_book_update)
        self.strategy.register_order_handler(self._on_strategy_quote)
        
        # Metrics
        self.start_time = None
        self.events_processed = 0
        self.total_latency: List[int] = []
    
    def _on_market_event(self, event: MarketEvent):
        """Stage 1→2: FeedParser → OrderBook"""
        if event.message_type == MessageType.ADD_ORDER:
            order = Order(
                order_id=event.order_id,
                symbol=event.symbol,
                price=event.price,
                quantity=event.quantity,
                side=event.side,
                timestamp_ns=event.timestamp_ns
            )
            self.order_book.add_order(order)
        elif event.message_type == MessageType.CANCEL_ORDER:
            self.order_book.cancel_order(event.order_id)
        elif event.message_type == MessageType.EXECUTE_ORDER:
            self.order_book.execute_order(event.order_id, event.quantity)
    
    def _on_order_book_update(self, update):
        """Stage 2→3: OrderBook → Strategy"""
        book_data = self.order_book.get_depth(5)
        book_data['mid_price'] = self.order_book.get_mid_price()
        self.strategy.on_order_book_update(book_data)
    
    def _on_strategy_quote(self, quote: Dict):
        """Stage 3→4: Strategy → Execution"""
        # In real HFT, this would send orders to exchange
        # For simulation, we just log the quote
        pass
    
    def process_event(self, raw_message: bytes) -> Dict:
        """Process a single market data message through entire pipeline"""
        start_ns = time.perf_counter_ns()
        
        # Run through pipeline
        event = self.feed_parser.parse_message(raw_message)
        
        end_ns = time.perf_counter_ns()
        latency = end_ns - start_ns
        self.total_latency.append(latency)
        self.events_processed += 1
        
        return {
            'event': event,
            'latency_ns': latency,
            'book_state': self.order_book.get_stats(),
            'strategy_state': self.strategy.get_stats()
        }
    
    def run_simulation(self, num_events: int = 100, events_per_second: int = 10000):
        """Run full simulation with generated market data"""
        print(f"🚀 Starting HFT Pipeline Simulation")
        print(f"   Symbol: {self.symbol}")
        print(f"   Events: {num_events}")
        print(f"   Rate: {events_per_second}/sec\n")
        
        self.start_time = time.time()
        interval = 1.0 / events_per_second
        
        for i in range(num_events):
            # Generate realistic test data
            side = 'B' if i % 2 == 0 else 'S'
            msg_type = MessageType.ADD_ORDER
            
            msg = create_test_message(
                msg_type=msg_type,
                order_id=10000 + i,
                symbol=self.symbol,
                price=15000 + (i % 100),  # Price varies $150.00 - $151.00
                quantity=100 + (i % 50) * 10,
                side=side
            )
            
            result = self.process_event(msg)
            
            # Progress update every 100 events
            if i % 100 == 0 and i > 0:
                elapsed = time.time() - self.start_time
                rate = i / elapsed if elapsed > 0 else 0
                print(f"   Progress: {i}/{num_events} ({rate:.0f} events/sec)")
            
            # Rate limiting (comment out for max speed test)
            # time.sleep(interval)
        
        # Print final stats
        self._print_stats(num_events)
    
    def _print_stats(self, total_events: int):
        """Print comprehensive statistics"""
        elapsed = time.time() - self.start_time
        
        print("\n" + "="*60)
        print("📊 SIMULATION RESULTS")
        print("="*60)
        
        # Throughput
        throughput = total_events / elapsed if elapsed > 0 else 0
        print(f"\n⚡ Throughput:")
        print(f"   Total Events:     {total_events:,}")
        print(f"   Elapsed Time:     {elapsed:.2f}s")
        print(f"   Events/Second:    {throughput:,.0f}")
        
        # Latency
        avg_latency = sum(self.total_latency) / len(self.total_latency) if self.total_latency else 0
        min_latency = min(self.total_latency) if self.total_latency else 0
        max_latency = max(self.total_latency) if self.total_latency else 0
        p99_latency = sorted(self.total_latency)[int(len(self.total_latency) * 0.99)] if len(self.total_latency) > 100 else max_latency
        
        print(f"\n⏱️  Pipeline Latency:")
        print(f"   Average:          {avg_latency:.0f} ns ({avg_latency/1000:.2f} μs)")
        print(f"   Min:              {min_latency:.0f} ns")
        print(f"   Max:              {max_latency:.0f} ns")
        print(f"   P99:              {p99_latency:.0f} ns")
        
        # Component stats
        print(f"\n🔧 Component Stats:")
        feed_stats = self.feed_parser.get_stats()
        print(f"   Feed Parser:      {feed_stats['messages_parsed']} messages, "
              f"{feed_stats['avg_latency_ns']:.0f}ns avg")
        
        book_stats = self.order_book.get_stats()
        print(f"   Order Book:       {book_stats['total_orders']} orders, "
              f"{book_stats['adds']} adds, {book_stats['cancels']} cancels")
        
        strat_stats = self.strategy.get_stats()
        print(f"   Strategy:         {strat_stats['quotes_generated']} quotes, "
              f"{strat_stats['trades_executed']} trades")
        print(f"   P&L:              ${strat_stats['pnl']/100:.2f}")
        print(f"   Position:         {strat_stats['position']} shares")
        
        print("\n" + "="*60)


def main():
    parser = argparse.ArgumentParser(description='HFT FPGA Simulation')
    parser.add_argument('--symbol', default='AAPL', help='Trading symbol')
    parser.add_argument('--events', type=int, default=1000, help='Number of events')
    parser.add_argument('--rate', type=int, default=100000, help='Events per second')
    parser.add_argument('--mode', choices=['simulated', 'live'], default='simulated')
    
    args = parser.parse_args()
    
    # Create and run pipeline
    pipeline = HFTPipeline(symbol=args.symbol)
    pipeline.run_simulation(num_events=args.events, events_per_second=args.rate)


if __name__ == '__main__':
    main()
