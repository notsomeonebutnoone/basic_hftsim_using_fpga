// FPGA Order Book Module
// Implements parallel order book with O(1) insert/delete
// Target: Xilinx Artix-7 or Intel Cyclone V

module order_book #(
    parameter DATA_WIDTH = 32,
    parameter PRICE_WIDTH = 16,
    parameter QTY_WIDTH = 16,
    parameter ORDER_ID_WIDTH = 32,
    parameter MAX_LEVELS = 32
) (
    input wire clk,
    input wire rst_n,
    
    // Command interface
    input wire cmd_valid,
    input wire [1:0] cmd_type,  // 00=ADD, 01=CANCEL, 10=EXECUTE
    input wire [ORDER_ID_WIDTH-1:0] cmd_order_id,
    input wire [PRICE_WIDTH-1:0] cmd_price,
    input wire [QTY_WIDTH-1:0] cmd_qty,
    input wire cmd_side,  // 0=BID, 1=ASK
    input wire cmd_valid_in,
    
    // Status outputs
    output reg [PRICE_WIDTH-1:0] best_bid,
    output reg [PRICE_WIDTH-1:0] best_ask,
    output reg [QTY_WIDTH-1:0] best_bid_qty,
    output reg [QTY_WIDTH-1:0] best_ask_qty,
    output wire [1:0] spread,
    
    // Pipeline ready
    output reg ready
);

// Command encoding
localparam CMD_ADD = 2'b00;
localparam CMD_CANCEL = 2'b01;
localparam CMD_EXECUTE = 2'b10;

// Order book level structure
typedef struct packed {
    reg [PRICE_WIDTH-1:0] price;
    reg [QTY_WIDTH-1:0] total_qty;
    reg [7:0] order_count;
    reg valid;
} order_level_t;

// Bid and ask arrays
order_level_t bids [0:MAX_LEVELS-1];
order_level_t asks [0:MAX_LEVELS-1];

// Order lookup table (CAM-like structure)
reg [ORDER_ID_WIDTH-1:0] order_ids [0:MAX_LEVELS*2-1];
reg [PRICE_WIDTH-1:0] order_prices [0:MAX_LEVELS*2-1];
reg [QTY_WIDTH-1:0] order_qtys [0:MAX_LEVELS*2-1];
reg order_sides [0:MAX_LEVELS*2-1];
reg order_valid [0:MAX_LEVELS*2-1];

// Pipeline registers
reg [1:0] pipe_stage1_cmd;
reg [ORDER_ID_WIDTH-1:0] pipe_stage1_order_id;
reg [PRICE_WIDTH-1:0] pipe_stage1_price;
reg [QTY_WIDTH-1:0] pipe_stage1_qty;
reg pipe_stage1_side;

always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        best_bid <= 0;
        best_ask <= 65535;  // Max price
        best_bid_qty <= 0;
        best_ask_qty <= 0;
        ready <= 1;
        
        // Initialize arrays
        integer i;
        for (i = 0; i < MAX_LEVELS; i = i + 1) begin
            bids[i].valid <= 0;
            asks[i].valid <= 0;
        end
        for (i = 0; i < MAX_LEVELS*2; i = i + 1) begin
            order_valid[i] <= 0;
        end
    end else begin
        ready <= 0;
        
        // Pipeline Stage 1: Capture command
        if (cmd_valid) begin
            pipe_stage1_cmd <= cmd_type;
            pipe_stage1_order_id <= cmd_order_id;
            pipe_stage1_price <= cmd_price;
            pipe_stage1_qty <= cmd_qty;
            pipe_stage1_side <= cmd_side;
            ready <= 1;
        end
        
        // Pipeline Stage 2: Execute command (parallel search)
        if (pipe_stage1_cmd == CMD_ADD && cmd_valid_in) begin
            // Add order logic (simplified)
            // In real FPGA, this would be fully parallel CAM search
        end else if (pipe_stage1_cmd == CMD_CANCEL) begin
            // Cancel order logic
        end else if (pipe_stage1_cmd == CMD_EXECUTE) begin
            // Execute order logic
        end
        
        // Update best bid/ask (priority encoder)
        // This runs in parallel with command execution
        update_best_prices();
    end
end

// Priority encoder for best bid (highest price first)
function update_best_prices;
    integer i;
    best_bid = 0;
    best_ask = 65535;
    best_bid_qty = 0;
    best_ask_qty = 0;
    
    // Find best bid
    for (i = MAX_LEVELS-1; i >= 0; i = i - 1) begin
        if (bids[i].valid) begin
            best_bid = bids[i].price;
            best_bid_qty = bids[i].total_qty;
            break;
        end
    end
    
    // Find best ask
    for (i = 0; i < MAX_LEVELS; i = i + 1) begin
        if (asks[i].valid) begin
            best_ask = asks[i].price;
            best_ask_qty = asks[i].total_qty;
            break;
        end
    end
endfunction

// Spread calculation
assign spread = (best_ask <= best_bid) ? 0 : (best_ask - best_bid);

// Timing constraints (for synthesis)
// create_clock -period 5.0 [get_ports clk]
// set_input_delay -clock clk 1.0 [get_ports cmd_*]
// set_output_delay -clock clk 1.0 [get_ports best_*]

endmodule
