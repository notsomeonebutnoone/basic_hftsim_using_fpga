"""
Order Book Manager
FPGA-style parallel order book with O(1) insert/delete operations
"""

import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from collections import defaultdict
from sortedcontainers import SortedDict
import heapq


@dataclass
class Order:
    """Represents a single order in the book"""
    order_id: int
    symbol: str
    price: int
    quantity: int
    side: str  # 'B' or 'S'
    timestamp_ns: int
    remaining_qty: int = field(init=False)
    
    def __post_init__(self):
        self.remaining_qty = self.quantity


@dataclass
class OrderBookUpdate:
    """Notification of order book change"""
    symbol: str
    action: str  # 'ADD', 'EXECUTE', 'CANCEL', 'UPDATE'
    order: Optional[Order]
    timestamp_ns: int


class OrderBookLevel:
    """Single price level in the order book"""
    
    def __init__(self, price: int, side: str):
        self.price = price
        self.side = side
        self.orders: Dict[int, Order] = {}  # order_id -> Order
        self.total_quantity = 0
        self.order_count = 0
    
    def add_order(self, order: Order) -> bool:
        """Add order to this level"""
        if order.order_id in self.orders:
            return False
        
        self.orders[order.order_id] = order
        self.total_quantity += order.quantity
        self.order_count += 1
        return True
    
    def remove_order(self, order_id: int) -> Optional[Order]:
        """Remove order from this level"""
        if order_id not in self.orders:
            return None
        
        order = self.orders.pop(order_id)
        self.total_quantity -= order.remaining_qty
        self.order_count -= 1
        return order
    
    def execute_order(self, order_id: int, quantity: int) -> Optional[Tuple[Order, int]]:
        """Execute (partially or fully) an order"""
        if order_id not in self.orders:
            return None
        
        order = self.orders[order_id]
        executed_qty = min(quantity, order.remaining_qty)
        order.remaining_qty -= executed_qty
        self.total_quantity -= executed_qty
        
        if order.remaining_qty == 0:
            del self.orders[order_id]
            self.order_count -= 1
        
        return (order, executed_qty)
    
    def get_best_order(self) -> Optional[Order]:
        """Get the oldest order at this level (price-time priority)"""
        if not self.orders:
            return None
        # Return order with earliest timestamp
        return min(self.orders.values(), key=lambda o: o.timestamp_ns)


class OrderBook:
    """
    Full order book with FPGA-style parallel access.
    Maintains separate bid and ask trees.
    """
    
    def __init__(self, symbol: str):
        self.symbol = symbol
        self.bids: SortedDict = SortedDict(lambda x: -x)  # Highest bid first
        self.asks: SortedDict = SortedDict()  # Lowest ask first
        self.orders: Dict[int, Order] = {}  # order_id -> Order (quick lookup)
        self.update_handlers: List = []
        self.stats = {
            'adds': 0,
            'executes': 0,
            'cancels': 0,
            'total_volume': 0
        }
    
    def add_order(self, order: Order) -> bool:
        """Add an order to the book"""
        if order.order_id in self.orders:
            return False
        
        # Select correct side
        book_side = self.bids if order.side == 'B' else self.asks
        
        # Create or get price level
        if order.price not in book_side:
            book_side[order.price] = OrderBookLevel(order.price, order.side)
        
        # Add order
        if book_side[order.price].add_order(order):
            self.orders[order.order_id] = order
            self.stats['adds'] += 1
            self._notify_update('ADD', order)
            return True
        
        return False
    
    def cancel_order(self, order_id: int) -> Optional[Order]:
        """Cancel an order"""
        if order_id not in self.orders:
            return None
        
        order = self.orders[order_id]
        book_side = self.bids if order.side == 'B' else self.asks
        
        if order.price in book_side:
            removed = book_side[order.price].remove_order(order_id)
            if removed:
                del self.orders[order_id]
                self.stats['cancels'] += 1
                self._notify_update('CANCEL', order)
                
                # Clean up empty price levels
                if book_side[order.price].order_count == 0:
                    del book_side[order.price]
                
                return removed
        
        return None
    
    def execute_order(self, order_id: int, quantity: int) -> Optional[Tuple[Order, int]]:
        """Execute (fill) an order"""
        if order_id not in self.orders:
            return None
        
        order = self.orders[order_id]
        book_side = self.bids if order.side == 'B' else self.asks
        
        if order.price in book_side:
            result = book_side[order.price].execute_order(order_id, quantity)
            if result:
                executed_order, executed_qty = result
                self.stats['executes'] += 1
                self.stats['total_volume'] += executed_qty
                
                # Remove from global lookup if fully filled
                if executed_order.remaining_qty == 0:
                    del self.orders[order_id]
                
                self._notify_update('EXECUTE', executed_order)
                return result
        
        return None
    
    def get_best_bid(self) -> Optional[Tuple[int, int]]:
        """Get best bid (price, quantity)"""
        if not self.bids:
            return None
        best_price = self.bids.peekitem(0)[0]
        return (best_price, self.bids[best_price].total_quantity)
    
    def get_best_ask(self) -> Optional[Tuple[int, int]]:
        """Get best ask (price, quantity)"""
        if not self.asks:
            return None
        best_price = self.asks.peekitem(0)[0]
        return (best_price, self.asks[best_price].total_quantity)
    
    def get_spread(self) -> Optional[int]:
        """Get bid-ask spread"""
        best_bid = self.get_best_bid()
        best_ask = self.get_best_ask()
        
        if best_bid and best_ask:
            return best_ask[0] - best_bid[0]
        return None
    
    def get_mid_price(self) -> Optional[float]:
        """Get mid price"""
        best_bid = self.get_best_bid()
        best_ask = self.get_best_ask()
        
        if best_bid and best_ask:
            return (best_bid[0] + best_ask[0]) / 2
        return None
    
    def get_depth(self, levels: int = 5) -> Dict:
        """Get order book depth"""
        bids = []
        asks = []
        
        for i, price in enumerate(list(self.bids.keys())[:levels]):
            level = self.bids[price]
            bids.append({
                'price': price,
                'quantity': level.total_quantity,
                'order_count': level.order_count
            })
        
        for i, price in enumerate(list(self.asks.keys())[:levels]):
            level = self.asks[price]
            asks.append({
                'price': price,
                'quantity': level.total_quantity,
                'order_count': level.order_count
            })
        
        return {'bids': bids, 'asks': asks, 'symbol': self.symbol}
    
    def register_handler(self, handler):
        """Register update handler"""
        self.update_handlers.append(handler)
    
    def _notify_update(self, action: str, order: Order):
        """Notify handlers of update"""
        update = OrderBookUpdate(
            symbol=self.symbol,
            action=action,
            order=order,
            timestamp_ns=time.time_ns()
        )
        for handler in self.update_handlers:
            handler(update)
    
    def get_stats(self) -> dict:
        """Return book statistics"""
        return {
            **self.stats,
            'total_orders': len(self.orders),
            'bid_levels': len(self.bids),
            'ask_levels': len(self.asks),
            'spread': self.get_spread(),
            'mid_price': self.get_mid_price()
        }


if __name__ == '__main__':
    # Test the order book
    book = OrderBook('AAPL')
    
    def on_update(update: OrderBookUpdate):
        print(f"{update.action}: {update.order.symbol} | "
              f"${update.order.price/100:.2f} x {update.order.quantity} | {update.order.side}")
    
    book.register_handler(on_update)
    
    # Add some orders
    print("Adding orders...")
    for i in range(5):
        bid = Order(
            order_id=1000 + i,
            symbol='AAPL',
            price=15000 - i * 10,  # $150.00, $149.90, ...
            quantity=100 + i * 50,
            side='B',
            timestamp_ns=time.time_ns()
        )
        book.add_order(bid)
        
        ask = Order(
            order_id=2000 + i,
            symbol='AAPL',
            price=15010 + i * 10,  # $150.10, $150.20, ...
            quantity=100 + i * 50,
            side='S',
            timestamp_ns=time.time_ns()
        )
        book.add_order(ask)
    
    print(f"\nBook Stats: {book.get_stats()}")
    print(f"Depth: {book.get_depth(3)}")
