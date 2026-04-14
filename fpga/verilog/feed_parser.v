// FPGA Market Data Feed Parser
// Parses ITCH-like protocol at line rate (1 byte/clock)
module feed_parser #(
    parameter DATA_WIDTH = 8,
    parameter TIMESTAMP_WIDTH = 64,
    parameter ORDER_ID_WIDTH = 64,
    parameter PRICE_WIDTH = 64,
    parameter QTY_WIDTH = 32
) (
    input wire clk,
    input wire rst_n,
    
    // Serial input (from network PHY)
    input wire [7:0] rx_byte,
    input wire rx_valid,
    input wire rx_sof,  // Start of frame
    input wire rx_eof,  // End of frame
    
    // Parsed output
    output reg [1:0] msg_type,
    output reg [TIMESTAMP_WIDTH-1:0] timestamp,
    output reg [ORDER_ID_WIDTH-1:0] order_id,
    output reg [31:0] symbol,  // 8 chars * 8 bits
    output reg [PRICE_WIDTH-1:0] price,
    output reg [QTY_WIDTH-1:0] quantity,
    output reg [7:0] side,
    output reg out_valid,
    
    // Status
    output reg parsing,
    output reg error_flag
);

localparam MSG_ADD = 3'h0;
localparam MSG_EXECUTE = 3'h1;
localparam MSG_CANCEL = 3'h2;
localparam MSG_TRADE = 3'h3;

// Parser state machine
typedef enum reg [2:0] {
    STATE_IDLE,
    STATE_TYPE,
    STATE_TIMESTAMP,
    STATE_ORDER_ID,
    STATE_SYMBOL,
    STATE_PRICE,
    STATE_QTY,
    STATE_SIDE,
    STATE_DONE
} parser_state_t;

parser_state_t state, next_state;
reg [6:0] byte_count;
reg [63:0] shift_reg;

// State register
always @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        state <= STATE_IDLE;
    else
        state <= next_state;
end

// Next state logic
always @(*) begin
    next_state = state;
    case (state)
        STATE_IDLE: if (rx_valid && rx_sof) next_state = STATE_TYPE;
        STATE_TYPE: if (rx_valid) next_state = STATE_TIMESTAMP;
        STATE_TIMESTAMP: if (rx_valid) next_state = STATE_ORDER_ID;
        STATE_ORDER_ID: if (rx_valid) next_state = STATE_SYMBOL;
        STATE_SYMBOL: if (rx_valid && byte_count >= 7) next_state = STATE_PRICE;
        STATE_PRICE: if (rx_valid) next_state = STATE_QTY;
        STATE_QTY: if (rx_valid) next_state = STATE_SIDE;
        STATE_SIDE: if (rx_valid) next_state = STATE_DONE;
        STATE_DONE: next_state = STATE_IDLE;
        default: next_state = STATE_IDLE;
    endcase
end

// Byte counter
always @(posedge clk or negedge rst_n) begin
    if (!rst_n)
        byte_count <= 0;
    else if (state == STATE_IDLE && rx_valid && rx_sof)
        byte_count <= 1;
    else if (rx_valid)
        byte_count <= byte_count + 1;
    else if (state == STATE_DONE)
        byte_count <= 0;
end

// Output register
always @(posedge clk) begin
    out_valid <= 0;
    
    if (state == STATE_TYPE && rx_valid)
        msg_type <= rx_byte;
    
    if (state == STATE_TIMESTAMP && rx_valid) begin
        shift_reg <= (shift_reg << 8) | rx_byte;
        if (byte_count >= 8)
            timestamp <= shift_reg;
    end
    
    if (state == STATE_ORDER_ID && rx_valid) begin
        shift_reg <= (shift_reg << 8) | rx_byte;
        if (byte_count >= 16)
            order_id <= shift_reg;
    end
    
    if (state == STATE_SYMBOL && rx_valid) begin
        symbol <= (symbol << 8) | rx_byte;
    end
    
    if (state == STATE_PRICE && rx_valid) begin
        shift_reg <= (shift_reg << 8) | rx_byte;
        if (byte_count >= 25)
            price <= shift_reg;
    end
    
    if (state == STATE_QTY && rx_valid) begin
        shift_reg <= (shift_reg << 8) | rx_byte;
        if (byte_count >= 29)
            quantity <= shift_reg;
    end
    
    if (state == STATE_SIDE && rx_valid) begin
        side <= rx_byte;
        out_valid <= 1;
    end
    
    parsing <= (state != STATE_IDLE);
end

endmodule
