# Actual MCP Server

A lightweight Node.js service that connects [Actual Finance](https://actualbudget.org/) to clients via the MCP protocol.  
Currently, this server focuses on integration with [LibreChat](https://github.com/danny-avila/LibreChat) but future efforts will include testing with other MCP-compatible clients.

---

## ⚠️ Warning

**This project is currently a work in progress and not fully working yet.**  
Expect incomplete functionality and potential bugs as additional tools and features are implemented.

---

## 🚀 Features

- Connects to Actual Finance server using configured server URL, password, and budget sync ID.
- Fetch account balances and recent transactions.
- Update budget categories and manage transactions.
- Supports multiple MCP server protocols for client integration:  
  - WebSocket MCP server  
  - Server-Sent Events (SSE) MCP server  
  - HTTP MCP server  
  - HTTP test server with hardcoded data for development
- Dynamic tool registration via `actualToolsManager`, with tools loaded based on Actual Finance API coverage.
- Supports testing modes:  
  - `--test-actual-connection`: test connection to Actual Finance and exit.  
  - `--test-actual-tools`: test connection and run all registered tools, then exit.
- Detailed debug logging with the `--debug` flag.
- Environment-configurable ports and paths.

---

## 🛠 Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/agigante80/librechat-actual-bridge.git
   cd librechat-actual-bridge
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   Copy `.env.example` to `.env` and update values:

   ```bash
   cp .env.example .env
   ```

   Edit .env to set:

   - `ACTUAL_SERVER_URL` — URL of your Actual Finance server
   - `ACTUAL_PASSWORD` — Your Actual Finance password
   - `ACTUAL_BUDGET_SYNC_ID` — Your budget sync ID
   - Optional: `MCP_BRIDGE_DATA_DIR`, `MCP_BRIDGE_PORT`

4. **Build the project**

   ```bash
   npm run build
   ```

5. **Run the bridge**

   - For WebSocket mode:

     ```bash
     npm run dev -- --ws --debug
     ```

   - For SSE mode (default):

     ```bash
     npm run dev -- --sse --debug
     ```

---

## ⚙️ Usage

- Connect LibreChat to the bridge via the specified protocol and port.
- Use the exposed tools: `get_balances`, `get_transactions`, etc.
- Debug logs are enabled with `--debug` flag.

---

## 🧪 Testing

*(Add testing instructions here if applicable)*

---

## 📄 License

MIT License

---

## 📢 Contributions

Contributions, issues, and feature requests are welcome!  
Feel free to check [issues page](https://github.com/yourusername/librechat-actual-bridge/issues).

---

## 🔗 Links

- [LibreChat](https://github.com/danny-avila/LibreChat)  
- [Actual Finance](https://actualbudget.org/)
