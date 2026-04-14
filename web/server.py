#!/usr/bin/env python3
"""
WebSocket Server for HFT Demo
Streams live simulation data to web frontend
"""

import asyncio
import json
from aiohttp import web
import sys
sys.path.append('../src')

from feed_parser.feed_parser import FeedParser, create_test_message, MessageType
from order_book.order_book import OrderBook, Order
from strategy.market_maker import MarketMaker

# Global connections
clients = set()
simulator = None


class LiveSimulator:
    def __init__(self):
        self.order_book = OrderBook('AAPL')
        self.parser = FeedParser()
        self.strategy = MarketMaker('AAPL')
        self.event_count = 0
        self.trades = []
        self.latencies = []
        self.pnl = 0
        self.position = 0
        
    def generate_event(self):
        side = 'B' if self.event_count % 2 == 0 else 'S'
        price = 15000 + (self.event_count % 100) - 50
        qty = 100 + (self.event_count % 5) * 50
        
        msg = create_test_message(
            order_id=10000 + self.event_count,
            symbol='AAPL',
            price=price,
            quantity=qty,
            side=side
        )
        
        return self.parser.parse_message(msg)
    
    def run_step(self):
        event = self.generate_event()
        if not event:
            return None
        
        self.event_count += 1
        
        # Add to order book
        order = Order(
            order_id=event.order_id,
            symbol=event.symbol,
            price=event.price,
            quantity=event.quantity,
            side=event.side,
            timestamp_ns=event.timestamp_ns
        )
        self.order_book.add_order(order)
        
        # Simulate trade every 5 events
        if self.event_count % 5 == 0:
            if event.side == 'B':
                self.position += event.quantity
                self.pnl -= event.price * event.quantity
            else:
                self.position -= event.quantity
                self.pnl += event.price * event.quantity
            
            self.trades.append({
                'id': self.event_count,
                'price': event.price / 100,
                'quantity': event.quantity,
                'side': event.side,
                'time': f"{event.timestamp_ns // 1000000000 % 86400}"
            })
            if len(self.trades) > 20:
                self.trades.pop(0)
        
        # Calculate latency
        latency = 200 + (self.event_count % 300)
        self.latencies.append(latency)
        if len(self.latencies) > 100:
            self.latencies.pop(0)
        
        return self.get_state()
    
    def get_state(self):
        book_depth = self.order_book.get_depth(5)
        best_bid = self.order_book.get_best_bid()
        best_ask = self.order_book.get_best_ask()
        
        spread = (best_ask[0] - best_bid[0]) / 100 if best_bid and best_ask else 0
        mid = (best_bid[0] + best_ask[0]) / 200 if best_bid and best_ask else 150
        
        return {
            'type': 'update',
            'orderBook': {
                'bids': [{'price': b['price']/100, 'size': b['quantity'], 'orders': b['order_count']} 
                        for b in book_depth['bids']],
                'asks': [{'price': a['price']/100, 'size': a['quantity'], 'orders': a['order_count']} 
                        for a in book_depth['asks']]
            },
            'spread': round(spread, 2),
            'midPrice': round(mid, 2),
            'metrics': {
                'latency': sum(self.latencies) // len(self.latencies) if self.latencies else 0,
                'throughput': self.event_count,
                'pnl': round(self.pnl / 100, 2),
                'position': self.position
            },
            'trades': self.trades[::-1]  # Reverse for latest first
        }


async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    clients.add(ws)
    print(f"🔌 Client connected. Total: {len(clients)}")
    
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                if data.get('action') == 'start':
                    print("▶ Simulation started")
                elif data.get('action') == 'stop':
                    print("⏹ Simulation stopped")
            elif msg.type == web.WSMsgType.ERROR:
                print(f"❌ WebSocket error: {ws.exception()}")
    finally:
        clients.discard(ws)
        print(f"🔌 Client disconnected. Total: {len(clients)}")
    
    return ws


async def broadcast_state(state):
    if clients:
        message = json.dumps(state)
        await asyncio.gather(
            *[client.send_str(message) for client in clients],
            return_exceptions=True
        )


async def simulation_loop():
    global simulator
    simulator = LiveSimulator()
    
    while True:
        if clients:
            state = simulator.run_step()
            if state:
                await broadcast_state(state)
        await asyncio.sleep(0.1)  # 10 updates per second


async def index(request):
    with open('index.html', 'r') as f:
        return web.Response(text=f.read(), content_type='text/html')


async def app_js(request):
    with open('app.js', 'r') as f:
        return web.Response(text=f.read(), content_type='application/javascript')


def create_app():
    app = web.Application()
    app.router.add_get('/', index)
    app.router.add_get('/app.js', app_js)
    app.router.add_get('/ws', websocket_handler)
    return app


if __name__ == '__main__':
    print("🚀 Starting HFT FPGA Simulator Web Server")
    print("📡 http://localhost:8080")
    
    app = create_app()
    
    # Start simulation loop
    app.on_startup.append(lambda app: asyncio.ensure_future(simulation_loop()))
    
    web.run_app(app, host='0.0.0.0', port=8080)
