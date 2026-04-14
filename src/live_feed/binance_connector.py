"""
Live Exchange Connector - Binance Testnet
Connects to real crypto exchange WebSocket feeds
"""

import asyncio
import json
import time
from typing import Callable, Optional, Dict
import websockets


class BinanceConnector:
    """Connect to Binance WebSocket for live market data"""
    
    def __init__(self, symbol: str = 'BTCUSDT'):
        self.symbol = symbol.lower()
        self.ws_url = f"wss://stream.binance.com:9443/ws/{self.symbol}@depth20@100ms"
        self.websocket: Optional[websockets.WebSocketClientProtocol] = None
        self.running = False
        self.message_handlers: list[Callable] = []
        self.stats = {
            'messages_received': 0,
            'errors': 0,
            'last_update': None
        }
    
    async def connect(self):
        """Establish WebSocket connection"""
        print(f"🔌 Connecting to Binance: {self.symbol.upper()}")
        
        try:
            async with websockets.connect(self.ws_url) as ws:
                self.websocket = ws
                self.running = True
                print(f"✅ Connected to {self.symbol.upper()}")
                
                while self.running:
                    try:
                        message = await asyncio.wait_for(ws.recv(), timeout=30)
                        data = json.loads(message)
                        self._process_message(data)
                    except asyncio.TimeoutError:
                        # Send ping to keep alive
                        pong = await ws.ping()
                        await asyncio.wait_for(pong, timeout=10)
                    except Exception as e:
                        self.stats['errors'] += 1
                        print(f"❌ Error: {e}")
                        
        except Exception as e:
            print(f"❌ Connection failed: {e}")
            raise
    
    def _process_message(self, data: Dict):
        """Process incoming depth update"""
        self.stats['messages_received'] += 1
        self.stats['last_update'] = time.time()
        
        # Parse Binance depth format
        bids = [(float(p), float(q)) for p, q in data.get('bids', [])]
        asks = [(float(p), float(q)) for p, q in data.get('asks', [])]
        
        event = {
            'timestamp': time.time_ns(),
            'symbol': self.symbol.upper(),
            'bids': bids,
            'asks': asks,
            'best_bid': bids[0] if bids else None,
            'best_ask': asks[0] if asks else None,
            'spread': (asks[0][0] - bids[0][0]) if bids and asks else 0
        }
        
        # Notify handlers
        for handler in self.message_handlers:
            handler(event)
    
    def register_handler(self, handler: Callable):
        """Register callback for market data"""
        self.message_handlers.append(handler)
    
    async def disconnect(self):
        """Close connection"""
        self.running = False
        if self.websocket:
            await self.websocket.close()
        print("🔌 Disconnected")
    
    def get_stats(self) -> Dict:
        return self.stats


class OrderBookSync:
    """Maintain local order book synced with exchange"""
    
    def __init__(self, symbol: str):
        self.symbol = symbol
        self.bids: Dict[float, float] = {}  # price -> quantity
        self.asks: Dict[float, float] = {}
        self.last_update_id: int = 0
    
    def update(self, event: Dict):
        """Update order book from Binance event"""
        # Update bids
        for price, qty in event['bids']:
            if qty == 0:
                self.bids.pop(price, None)
            else:
                self.bids[price] = qty
        
        # Update asks
        for price, qty in event['asks']:
            if qty == 0:
                self.asks.pop(price, None)
            else:
                self.asks[price] = qty
    
    def get_best_bid(self) -> tuple:
        if not self.bids:
            return None
        price = max(self.bids.keys())
        return (price, self.bids[price])
    
    def get_best_ask(self) -> tuple:
        if not self.asks:
            return None
        price = min(self.asks.keys())
        return (price, self.asks[price])
    
    def get_depth(self, levels: int = 10) -> Dict:
        """Get top N levels"""
        sorted_bids = sorted(self.bids.items(), key=lambda x: x[0], reverse=True)[:levels]
        sorted_asks = sorted(self.asks.items(), key=lambda x: x[0])[:levels]
        
        return {
            'bids': [{'price': p, 'qty': q} for p, q in sorted_bids],
            'asks': [{'price': p, 'qty': q} for p, q in sorted_asks]
        }


async def main():
    """Demo: Connect to Binance and display order book"""
    connector = BinanceConnector('BTCUSDT')
    book = OrderBookSync('BTCUSDT')
    
    def on_market_data(event):
        book.update(event)
        best_bid = book.get_best_bid()
        best_ask = book.get_best_ask()
        
        if best_bid and best_ask:
            spread = best_ask[0] - best_bid[0]
            print(f"BTC/USDT | Bid: ${best_bid[0]:,.2f} | Ask: ${best_ask[0]:,.2f} | "
                  f"Spread: ${spread:.2f} | Updates: {connector.stats['messages_received']}")
    
    connector.register_handler(on_market_data)
    
    try:
        await connector.connect()
    except KeyboardInterrupt:
        await connector.disconnect()


if __name__ == '__main__':
    asyncio.run(main())
