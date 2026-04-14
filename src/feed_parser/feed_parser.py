"""
Market Data Feed Parser
Simulates FPGA-style parsing of exchange market data feeds (ITCH/OUCH protocol)
"""

import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional, List, Callable


class MessageType(Enum):
    ADD_ORDER = 'A'
    EXECUTE_ORDER = 'E'
    CANCEL_ORDER = 'X'
    TRADE = 'P'
    BOOK_CLEAR = 'L'


@dataclass
class MarketEvent:
    """Represents a parsed market data event"""
    timestamp_ns: int
    message_type: MessageType
    order_id: int
    symbol: str
    price: int  # Price in cents (integer for speed)
    quantity: int
    side: str  # 'B' or 'S'
    raw_bytes: bytes


class FeedParser:
    """
    FPGA-style feed parser with pipeline architecture.
    Designed to parse one byte per clock cycle (simulated).
    """
    
    def __init__(self):
        self.pipeline_stages = {
            'fetch': 0,
            'decode': 0,
            'validate': 0,
            'extract': 0
        }
        self.latency_history: List[int] = []
        self.event_handlers: List[Callable] = []
        self.stats = {
            'messages_parsed': 0,
            'bytes_processed': 0,
            'errors': 0
        }
    
    def parse_message(self, raw_bytes: bytes) -> Optional[MarketEvent]:
        """
        Parse a single market data message.
        Simulates FPGA pipeline: fetch → decode → validate → extract
        """
        start_ns = time.perf_counter_ns()
        
        if len(raw_bytes) < 8:
            self.stats['errors'] += 1
            return None
        
        # Stage 1: Fetch (read message type)
        msg_type_byte = raw_bytes[0]
        try:
            msg_type = MessageType(chr(msg_type_byte))
        except ValueError:
            self.stats['errors'] += 1
            return None
        
        # Stage 2: Decode (extract fields based on protocol)
        # ITCH-like format: [type(1)][timestamp(8)][order_id(8)][symbol(8)][price(8)][qty(4)][side(1)]
        if len(raw_bytes) < 38:
            self.stats['errors'] += 1
            return None
        
        timestamp_ns = int.from_bytes(raw_bytes[1:9], 'big')
        order_id = int.from_bytes(raw_bytes[9:17], 'big')
        symbol = raw_bytes[17:25].decode('ascii').strip()
        price = int.from_bytes(raw_bytes[25:33], 'big')
        quantity = int.from_bytes(raw_bytes[33:37], 'big')
        side = chr(raw_bytes[37])
        
        # Stage 3: Validate (checksum, range checks)
        if price <= 0 or quantity <= 0:
            self.stats['errors'] += 1
            return None
        
        # Stage 4: Extract (create event object)
        event = MarketEvent(
            timestamp_ns=timestamp_ns,
            message_type=msg_type,
            order_id=order_id,
            symbol=symbol,
            price=price,
            quantity=quantity,
            side=side,
            raw_bytes=raw_bytes
        )
        
        end_ns = time.perf_counter_ns()
        latency = end_ns - start_ns
        self.latency_history.append(latency)
        
        self.stats['messages_parsed'] += 1
        self.stats['bytes_processed'] += len(raw_bytes)
        
        # Notify handlers (simulates FPGA output to next pipeline stage)
        for handler in self.event_handlers:
            handler(event)
        
        return event
    
    def register_handler(self, handler: Callable):
        """Register callback for parsed events"""
        self.event_handlers.append(handler)
    
    def get_stats(self) -> dict:
        """Return parser statistics"""
        avg_latency = sum(self.latency_history) / len(self.latency_history) if self.latency_history else 0
        return {
            **self.stats,
            'avg_latency_ns': avg_latency,
            'min_latency_ns': min(self.latency_history) if self.latency_history else 0,
            'max_latency_ns': max(self.latency_history) if self.latency_history else 0
        }


def create_test_message(
    msg_type: MessageType = MessageType.ADD_ORDER,
    order_id: int = 12345,
    symbol: str = 'AAPL',
    price: int = 15000,  # $150.00
    quantity: int = 100,
    side: str = 'B'
) -> bytes:
    """Create a test message in ITCH-like format"""
    timestamp = time.time_ns()
    
    # Pad symbol to 8 bytes
    symbol_bytes = symbol.encode('ascii').ljust(8, b' ')
    
    message = (
        msg_type.value.encode('ascii') +
        timestamp.to_bytes(8, 'big') +
        order_id.to_bytes(8, 'big') +
        symbol_bytes +
        price.to_bytes(8, 'big') +
        quantity.to_bytes(4, 'big') +
        side.encode('ascii')
    )
    
    return message


if __name__ == '__main__':
    # Test the parser
    parser = FeedParser()
    
    def on_event(event: MarketEvent):
        print(f"Event: {event.message_type.name} | {event.symbol} | "
              f"${event.price/100:.2f} x {event.quantity} | {event.side}")
    
    parser.register_handler(on_event)
    
    # Parse test messages
    print("Testing Feed Parser...")
    for i in range(10):
        msg = create_test_message(
            order_id=1000 + i,
            price=15000 + i * 10,
            quantity=100 + i * 10
        )
        parser.parse_message(msg)
    
    stats = parser.get_stats()
    print(f"\nStats: {stats['messages_parsed']} messages, "
          f"avg latency: {stats['avg_latency_ns']:.0f}ns")
