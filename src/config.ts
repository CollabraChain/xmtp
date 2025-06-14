import * as fs from "fs";
import path from "path";

// Environment configuration interface
export interface Config {
  // Network Configuration
  networkId: string;
  socketPort: number;
  frontendUrl: string;

  // API Keys
  cdpApiKeyId: string;
  cdpApiKeySecret: string;
  openaiApiKey: string;

  // Optional Configuration
  walletSecret?: string;
  paymasterUrl?: string;
  logLevel: string;

  // Contract Addresses
  collabraChainFactoryAddress: string;
  usdcAddress: string;
}

// Default configuration
const DEFAULT_CONFIG: Partial<Config> = {
  networkId: "base-mainnet",
  socketPort: 3001,
  frontendUrl: "http://localhost:3000",
  logLevel: "info",
  paymasterUrl:
    "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
  collabraChainFactoryAddress: "0xfB250Bf4c8F9E80fEE15FF978ad1a6289dED9C2f",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913",
};

/**
 * Validate and load configuration from environment variables
 */
export function loadConfig(): Config {
  const requiredEnvVars = [
    "CDP_API_KEY_ID",
    "CDP_API_KEY_SECRET",
    "OPENAI_API_KEY",
  ];

  const missingVars = requiredEnvVars.filter(
    (varName) => !process.env[varName],
  );

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`,
    );
  }

  const config: Config = {
    // Required variables
    cdpApiKeyId: process.env.CDP_API_KEY_ID as string,
    cdpApiKeySecret: process.env.CDP_API_KEY_SECRET as string,
    openaiApiKey: process.env.OPENAI_API_KEY as string,

    // Optional variables with defaults
    networkId: process.env.NETWORK_ID || (DEFAULT_CONFIG.networkId as string),
    socketPort: parseInt(
      process.env.SOCKET_PORT ||
        (DEFAULT_CONFIG.socketPort as number).toString(),
    ),
    frontendUrl:
      process.env.FRONTEND_URL || (DEFAULT_CONFIG.frontendUrl as string),
    logLevel: process.env.LOG_LEVEL || (DEFAULT_CONFIG.logLevel as string),
    paymasterUrl:
      process.env.PAYMASTER_URL || (DEFAULT_CONFIG.paymasterUrl as string),
    collabraChainFactoryAddress:
      process.env.COLLABRA_CHAIN_FACTORY_ADDRESS ||
      (DEFAULT_CONFIG.collabraChainFactoryAddress as string),
    usdcAddress:
      process.env.USDC_ADDRESS || (DEFAULT_CONFIG.usdcAddress as string),

    // Optional wallet secret
    walletSecret: process.env.WALLET_SECRET,
  };

  return config;
}

/**
 * Create example environment file
 */
export function createExampleEnv(): void {
  const exampleContent = `# Network Configuration
NETWORK_ID=base-mainnet
SOCKET_PORT=3001
FRONTEND_URL=http://localhost:3000

# Coinbase Developer Platform Keys
CDP_API_KEY_ID=your_cdp_api_key_id_here
CDP_API_KEY_SECRET=your_cdp_api_key_secret_here

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Wallet Configuration (Optional - will be generated if not provided)
WALLET_SECRET=your_secure_wallet_secret_here

# Payment Configuration
PAYMASTER_URL=https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO

# Logging
LOG_LEVEL=info

# Contract Addresses (Base Mainnet)
COLLABRA_CHAIN_FACTORY_ADDRESS=0xfB250Bf4c8F9E80fEE15FF978ad1a6289dED9C2f
USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913
`;

  const envPath = path.join(process.cwd(), ".env.example");

  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, exampleContent);
    console.log("✅ Created .env.example file");
  }
}

/**
 * Logger utility for production
 */
export const Logger = {
  logLevel: process.env.LOG_LEVEL || "info",

  debug(message: string, ...args: unknown[]): void {
    if (this.logLevel === "debug") {
      console.debug(
        `[DEBUG] ${new Date().toISOString()} - ${message}`,
        ...args,
      );
    }
  },

  info(message: string, ...args: unknown[]): void {
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
  },

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
  },

  error(message: string, error?: unknown): void {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, error);
  },
};

export default { loadConfig, createExampleEnv, Logger };
