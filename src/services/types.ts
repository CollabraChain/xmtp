import { CdpClient, CdpEvmSmartAccount } from "@coinbase/agentkit";
import { TransactionReceipt } from "viem";

export interface SmartWalletConfig {
  apiKeyId: string;
  apiKeySecret: string;
  networkId: string;
  walletSecret: string;
}

export interface SmartWalletUserOperation {
  userOpHash: string;
  transactionHash?: string;
  status: "pending" | "complete" | "failed";
  receipt?: TransactionReceipt;
  error?: Error;
}

export interface TransactionHistoryItem {
  hash: string;
  timestamp: number;
  from: string;
  to: string;
  value: string;
  status: "success" | "failed" | "pending";
  method?: string;
  blockNumber?: number;
}

export interface TokenBalance {
  token: string;
  symbol: string;
  balance: string;
  decimals: number;
  formattedBalance: string;
}

export interface SmartWalletState {
  address: string;
  isInitialized: boolean;
  nativeBalance: string;
  tokenBalances: TokenBalance[];
  transactions: TransactionHistoryItem[];
  lastUpdated: number;
}

export interface ContractCallParams {
  contractAddress: string;
  abi: any;
  functionName: string;
  args: any[];
}

export interface TokenTransferParams {
  tokenAddress: string;
  to: string;
  amount: string;
  decimals: number;
}

export interface WalletStorageProvider {
  getWalletData(userId: string): Promise<SmartWalletState | null>;
  saveWalletData(userId: string, data: SmartWalletState): Promise<void>;
}
