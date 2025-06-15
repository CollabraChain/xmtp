# 🏗️ CollabraChain Agent - Socket.IO Production System

A production-ready decentralized freelance project management agent using Socket.IO for real-time communication.

## ✨ Features

- **🔌 Real-time Communication**: Socket.IO server with WebSocket support
- **🤖 AI-Powered Agent**: OpenAI GPT-4 integration for intelligent responses
- **⛓️ Blockchain Integration**: Coinbase Developer Platform for smart contracts
- **💾 Data Persistence**: Local storage with conversation history
- **🌐 Web Interface**: Beautiful, responsive client interface
- **📊 Production Monitoring**: Health checks, stats, and logging

## 🚀 Quick Start

### Prerequisites

- Node.js v20 or later
- Yarn package manager
- Coinbase Developer Platform account
- OpenAI API account

### 1. Environment Setup

```bash
# Required environment variables
CDP_API_KEY_ID=your_cdp_api_key_id
CDP_API_KEY_SECRET=your_cdp_api_key_secret
OPENAI_API_KEY=your_openai_api_key

# Optional settings
SOCKET_PORT=3001
NETWORK_ID=base-mainnet
LOG_LEVEL=info
```

### 2. Install & Run

```bash
# Install dependencies
yarn install

# Start production server
yarn start

# Or development mode with auto-reload
yarn dev
```

### 3. Access Interface

- **Web Interface**: http://localhost:3001
- **Health Check**: http://localhost:3001/health

## 🛠️ Development Scripts

```bash
yarn start          # Production mode
yarn dev            # Development with auto-reload
yarn start:socket   # Socket server only
yarn clean          # Clean data directories
yarn lint           # Run linting
```

## 🤖 Agent Commands

- `/create` - Create new project
- `/list` - Browse projects
- `/dashboard` - View your dashboard
- `/help` - Show all commands

## 📡 Socket.IO Events

### Client → Server

```javascript
// Authenticate
socket.emit("authenticate", { userId, address });

// Send message
socket.emit("user_message", { content, userId, conversationId });
```

### Server → Client

```javascript
// Authentication result
socket.on('authenticated', (data) => { ... });

// Agent response
socket.on('agent_message', (data) => { ... });
```

## 📊 Monitoring

Health check endpoint:

```bash
curl http://localhost:3001/health
```

## 🐳 Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN yarn install --production
COPY . .
EXPOSE 3001
CMD ["yarn", "start"]
```

## 🚨 Troubleshooting

**Port in use**: Change `SOCKET_PORT` environment variable
**Missing deps**: Run `yarn install`
**API errors**: Check your `.env` file has all required keys

---

**Note**: This replaces the previous XMTP implementation with Socket.IO for improved production reliability.
