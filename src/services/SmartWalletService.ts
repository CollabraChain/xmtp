import {
  AgentKit,
  cdpApiActionProvider,
  CdpV2WalletProvider,
  cdpWalletActionProvider,
  erc20ActionProvider,
  walletActionProvider,
} from "@coinbase/agentkit";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  formatUnits,
  http,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { FileStorageProvider } from "./FileStorageProvider";
import type {
  ContractCallParams,
  SmartWalletConfig,
  SmartWalletState,
  SmartWalletUserOperation,
  TokenBalance,
  TokenTransferParams,
  TransactionHistoryItem,
  WalletStorageProvider,
} from "./types";

// ERC20 standard ABI for token interactions
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: "_owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "balance", type: "uint256" }],
    type: "function",
  },
  {
    constant: false,
    inputs: [
      { name: "_to", type: "address" },
      { name: "_value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "success", type: "bool" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "decimals",
    outputs: [{ name: "", type: "uint8" }],
    type: "function",
  },
  {
    constant: true,
    inputs: [],
    name: "symbol",
    outputs: [{ name: "", type: "string" }],
    type: "function",
  },
];

/**
 * Enhanced Smart Wallet Service for Coinbase CDP integration
 * Provides a comprehensive interface for wallet operations
 */
export class SmartWalletService {
  private walletProvider: typeof CdpV2WalletProvider;
  private ownerAccount: `0x${string}`;
  private cdpClient: any;
  private smartAccount: any;
  private agentKit: AgentKit;
  private storageProvider: WalletStorageProvider;
  private publicClient: any;

  // Common token addresses
  private readonly USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";
  private readonly PAYMASTER_URL =
    "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO";

  /**
   * Create a new SmartWalletService instance
   *
   * @param config - Configuration for the smart wallet
   * @param ownerKey - Private key of the owner account
   * @param storageDir - Directory for wallet data storage
   */
  constructor(
    private config: SmartWalletConfig,
    private ownerKey: string,
    storageDir: string = ".data/wallet",
  ) {
    this.ownerAccount = ownerKey as `0x${string}`;
    this.storageProvider = new FileStorageProvider(storageDir);
    this.publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });
  }

  /**
   * Initialize the smart wallet service
   */
  async initialize(): Promise<void> {
    try {
      // Configure wallet provider with CDP
      this.walletProvider = await CdpV2WalletProvider.configureWithWallet({
        apiKeyId: this.config.apiKeyId,
        apiKeySecret: this.config.apiKeySecret,
        networkId: this.config.networkId,
        walletSecret: this.config.walletSecret,
      });

      // Create wallet client for the owner account
      const accountOwner = privateKeyToAccount(this.ownerAccount);
      const walletClient = createWalletClient({
        account: accountOwner,
        chain: base,
        transport: http(),
      });

      // Get or create smart account
      this.smartAccount = await this.walletProvider
        .getClient()
        .evm.getOrCreateSmartAccount({
          name: "AGENT",
          owner: walletClient.account,
        });

      // Initialize AgentKit with action providers
      this.agentKit = await AgentKit.from({
        walletProvider: this.walletProvider,
        actionProviders: [
          walletActionProvider(),
          erc20ActionProvider(),
          cdpApiActionProvider({
            apiKeyId: this.config.apiKeyId,
            apiKeySecret: this.config.apiKeySecret,
          }),
          cdpWalletActionProvider({
            apiKeyId: this.config.apiKeyId,
            apiKeySecret: this.config.apiKeySecret,
          }),
        ],
      });

      // Store CDP client for direct API access
      this.cdpClient = this.walletProvider.getClient();
    } catch (error) {
      console.error("Failed to initialize smart wallet service:", error);
      throw new Error(`Smart wallet initialization failed: ${error}`);
    }
  }

  /**
   * Get the smart account address
   *
   * @returns The smart account address
   */
  getAddress(): string {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }
    return this.smartAccount.address;
  }

  /**
   * Load or initialize wallet state for a user
   *
   * @param userId - Unique identifier for the user
   * @returns The wallet state
   */
  async getOrCreateWalletState(userId: string): Promise<SmartWalletState> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    // Try to load existing wallet data
    const existingData = await this.storageProvider.getWalletData(userId);

    if (existingData) {
      // If data exists but is stale (older than 5 minutes), refresh it
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      if (existingData.lastUpdated < fiveMinutesAgo) {
        return this.refreshWalletState(userId);
      }
      return existingData;
    }

    // Create new wallet state
    const initialState: SmartWalletState = {
      address: this.smartAccount.address,
      isInitialized: true,
      nativeBalance: "0",
      tokenBalances: [],
      transactions: [],
      lastUpdated: Date.now(),
    };

    // Refresh to get accurate data
    return this.refreshWalletState(userId, initialState);
  }

  /**
   * Refresh the wallet state with latest data
   *
   * @param userId - Unique identifier for the user
   * @param baseState - Optional base state to update
   * @returns Updated wallet state
   */
  async refreshWalletState(
    userId: string,
    baseState?: SmartWalletState,
  ): Promise<SmartWalletState> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    // Start with existing state or create new one
    const state = baseState ||
      (await this.storageProvider.getWalletData(userId)) || {
        address: this.smartAccount.address,
        isInitialized: true,
        nativeBalance: "0",
        tokenBalances: [],
        transactions: [],
        lastUpdated: Date.now(),
      };

    try {
      // Get native ETH balance
      const nativeBalance = await this.publicClient.getBalance({
        address: this.smartAccount.address,
      });
      state.nativeBalance = nativeBalance.toString();

      // Get USDC balance
      const tokenBalances: TokenBalance[] = [];
      const usdcBalance = await this.getTokenBalance(this.USDC_ADDRESS);
      if (usdcBalance) {
        tokenBalances.push(usdcBalance);
      }

      // Get transaction history
      const transactions = await this.getTransactionHistory();

      // Update state
      state.tokenBalances = tokenBalances;
      state.transactions = transactions;
      state.lastUpdated = Date.now();

      // Save updated state
      await this.storageProvider.saveWalletData(userId, state);

      return state;
    } catch (error) {
      console.error("Failed to refresh wallet state:", error);
      // Return existing state even if refresh failed
      return state;
    }
  }

  /**
   * Get balance of a specific ERC20 token
   *
   * @param tokenAddress - Address of the token contract
   * @returns Token balance information or null if failed
   */
  async getTokenBalance(tokenAddress: string): Promise<TokenBalance | null> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    try {
      // Get token balance
      const balanceResult = await this.publicClient.readContract({
        address: tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [this.smartAccount.address],
      });

      // Get token metadata
      const [decimals, symbol] = await Promise.all([
        this.publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
        this.publicClient.readContract({
          address: tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
      ]);

      const balance = balanceResult.toString();
      const formattedBalance = formatUnits(BigInt(balance), decimals);

      return {
        token: tokenAddress,
        symbol: symbol,
        balance,
        decimals,
        formattedBalance,
      };
    } catch (error) {
      console.error(`Failed to get token balance for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Get transaction history for the smart account
   *
   * @param limit - Maximum number of transactions to fetch
   * @returns Array of transaction history items
   */
  async getTransactionHistory(
    limit: number = 10,
  ): Promise<TransactionHistoryItem[]> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    try {
      // Use CDP API to get transaction history
      const response = await this.cdpClient.cdpApi.getTransactionHistory({
        networkId: this.config.networkId,
        walletAddress: this.smartAccount.address,
        limit,
      });

      if (!response || !response.transactions) {
        return [];
      }

      // Transform response to our standard format
      return response.transactions.map((tx: any) => ({
        hash: tx.hash,
        timestamp: tx.timestamp,
        from: tx.from,
        to: tx.to,
        value: tx.value,
        status: tx.status,
        method: tx.methodName,
        blockNumber: tx.blockNumber,
      }));
    } catch (error) {
      console.error("Failed to get transaction history:", error);
      return [];
    }
  }

  /**
   * Send native tokens (ETH)
   *
   * @param to - Recipient address
   * @param amount - Amount to send in wei
   * @returns User operation result
   */
  async sendNativeTokens(
    to: string,
    amount: bigint,
  ): Promise<SmartWalletUserOperation> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    try {
      const userOp = await this.walletProvider
        .getClient()
        .evm.sendUserOperation({
          smartAccount: this.smartAccount,
          network: "base",
          paymasterUrl: this.PAYMASTER_URL,
          calls: [
            {
              to: to as `0x${string}`,
              value: amount,
              data: "0x",
            },
          ],
        });

      return this.waitForUserOperation(userOp.userOpHash);
    } catch (error) {
      console.error("Failed to send native tokens:", error);
      return {
        userOpHash: "",
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Transfer ERC20 tokens
   *
   * @param params - Token transfer parameters
   * @returns User operation result
   */
  async transferTokens(
    params: TokenTransferParams,
  ): Promise<SmartWalletUserOperation> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    try {
      const amount = parseUnits(params.amount, params.decimals);

      const userOp = await this.walletProvider
        .getClient()
        .evm.sendUserOperation({
          smartAccount: this.smartAccount,
          network: "base",
          paymasterUrl: this.PAYMASTER_URL,
          calls: [
            {
              to: params.tokenAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: ERC20_ABI,
                functionName: "transfer",
                args: [params.to as `0x${string}`, amount],
              }),
            },
          ],
        });

      return this.waitForUserOperation(userOp.userOpHash);
    } catch (error) {
      console.error("Failed to transfer tokens:", error);
      return {
        userOpHash: "",
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Call a contract function
   *
   * @param params - Contract call parameters
   * @returns User operation result
   */
  async callContract(
    params: ContractCallParams,
  ): Promise<SmartWalletUserOperation> {
    if (!this.smartAccount) {
      throw new Error("Smart wallet not initialized");
    }

    try {
      const userOp = await this.walletProvider
        .getClient()
        .evm.sendUserOperation({
          smartAccount: this.smartAccount,
          network: "base",
          paymasterUrl: this.PAYMASTER_URL,
          calls: [
            {
              to: params.contractAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: params.abi,
                functionName: params.functionName,
                args: params.args,
              }),
            },
          ],
        });

      return this.waitForUserOperation(userOp.userOpHash);
    } catch (error) {
      console.error("Failed to call contract:", error);
      return {
        userOpHash: "",
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Create a project in the CollabraChain contract
   *
   * @param contractAddress - Address of the CollabraChain factory contract
   * @param abi - ABI of the CollabraChain factory contract
   * @param client - Client address
   * @param freelancer - Freelancer address
   * @param milestoneDescriptions - Array of milestone descriptions
   * @param milestonePayments - Array of milestone payments
   * @returns User operation result
   */
  async createProject(
    contractAddress: string,
    abi: any,
    client: string,
    freelancer: string,
    milestoneDescriptions: string[],
    milestonePayments: string[],
  ): Promise<SmartWalletUserOperation> {
    return this.callContract({
      contractAddress,
      abi,
      functionName: "createProject",
      args: [
        client as `0x${string}`,
        freelancer as `0x${string}`,
        milestoneDescriptions,
        milestonePayments.map((payment) => parseUnits(payment, 6)),
      ],
    });
  }

  /**
   * Approve a milestone in the CollabraChain project
   *
   * @param projectAddress - Address of the project contract
   * @param abi - ABI of the project contract
   * @param milestoneIndex - Index of the milestone to approve
   * @returns User operation result
   */
  async approveMilestone(
    projectAddress: string,
    abi: any,
    milestoneIndex: number,
  ): Promise<SmartWalletUserOperation> {
    return this.callContract({
      contractAddress: projectAddress,
      abi,
      functionName: "approveMilestone",
      args: [milestoneIndex],
    });
  }

  /**
   * Wait for a user operation to complete
   *
   * @param userOpHash - Hash of the user operation
   * @returns User operation result
   */
  private async waitForUserOperation(
    userOpHash: string,
  ): Promise<SmartWalletUserOperation> {
    try {
      console.log("Waiting for user operation to be confirmed...");
      const userOperation = await this.walletProvider
        .getClient()
        .evm.waitForUserOperation({
          smartAccountAddress: this.smartAccount.address,
          userOpHash,
        });

      if (userOperation.status === "complete") {
        return {
          userOpHash,
          transactionHash: userOperation.transactionHash,
          status: userOperation.status,
          receipt: userOperation.receipt,
        };
      } else {
        return {
          userOpHash,
          status: "failed",
          error: new Error("Transaction failed"),
        };
      }
    } catch (error) {
      console.error("Error waiting for user operation:", error);
      return {
        userOpHash,
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Get the AgentKit instance
   *
   * @returns The initialized AgentKit instance
   */
  getAgentKit(): AgentKit {
    if (!this.agentKit) {
      throw new Error("AgentKit not initialized");
    }
    return this.agentKit;
  }
}
