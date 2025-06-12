# CollabraChain XMTP Agent

This project demonstrates a powerful agent running on the [XMTP](https://xmtp.org/) network, integrating [Coinbase AgentKit](https://github.com/coinbase/agentkit), [LangChain](https://js.langchain.com/), and onchain project management via smart contracts. It enables secure, decentralized, and programmable messaging with advanced automation and blockchain actions.

---

## Features

- **XMTP Messaging**: End-to-end encrypted, decentralized, and programmable messaging.
- **AgentKit + LangChain**: Use LLMs and onchain actions for automation, project management, and more.
- **Smart Contract Integration**: Create and manage collaboration projects, milestones, and payments onchain.
- **Extensible Tools**: Easily add new actions using the AgentKit/LangChain tool interface.
- **Secure Key Management**: Uses secure key generation and local encrypted storage.
- **Dockerized Local Network**: Run your own XMTP node for local development and testing.

---

## Requirements

- Node.js v20 or higher
- Yarn v4.6.0 or higher
- Docker (for local XMTP network)
- [OpenAI API Key](https://platform.openai.com/api-keys)
- [Coinbase Developer Platform (CDP) API credentials](https://portal.cdp.coinbase.com)
- USDC testnet tokens ([faucet](https://faucet.circle.com))

---

## Quick Start

1. **Clone the repository:**

   ```bash
   git clone https://github.com/CollabraChain/xmtp
   cd xmtp
   ```

2. **Install dependencies:**

   ```bash
   yarn install
   ```

3. **Generate XMTP keys:**

   ```bash
   yarn gen:keys
   ```

   This will append new keys to your `.env` file.

4. **Set up your `.env` file:**

   ```env
   WALLET_KEY=your_private_key
   ENCRYPTION_KEY=your_encryption_key
   XMTP_ENV=dev # or local, production
   NETWORK_ID=base-sepolia
   OPENAI_API_KEY=your_openai_key
   CDP_API_KEY_ID=your_cdp_key_id
   CDP_API_KEY_SECRET=your_cdp_key_secret
   ```

5. **Run the agent:**
   ```bash
   yarn dev
   ```

---

## Local XMTP Network (Optional)

To run a local XMTP node for development:

```bash
cd dev
./up
```

Set `XMTP_ENV=local` in your `.env` file.

---

## Usage

- The agent listens for messages on XMTP and can:
  - Create onchain project contracts
  - Approve milestones and release payments
  - Answer questions using OpenAI
  - Perform custom actions via LangChain tools

Example prompts:

- “Create a project with 3 milestones for address 0x...”
- “Approve milestone 2 for project 0x...”
- “What is the price of ETH?”

---

## Project Structure

- `src/` — Main agent logic, contract ABIs, and entrypoint
- `helpers/` — Utility functions for key management, environment validation, and logging
- `scripts/` — Key generation and setup scripts
- `dev/` — Docker Compose files and local XMTP node setup
- `examples/` — (If present) Additional agent examples

---

## Helper Utilities

- **Key Generation:** `yarn gen:keys` (never write your own script)
- **Environment Validation:** Ensures all required variables are set before running
- **Signer Creation:** Use `createSigner` from `@helpers/client`
- **Encryption Key Handling:** Use `getEncryptionKeyFromHex` from `@helpers/client`

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[Apache-2.0](LICENSE.md)

---

## References

- [XMTP Documentation](https://docs.xmtp.org/)
- [Coinbase AgentKit](https://github.com/coinbase/agentkit)
- [LangChain JS](https://js.langchain.com/)
- [OpenAI](https://platform.openai.com/)
- [CDP Developer Portal](https://portal.cdp.coinbase.com)
