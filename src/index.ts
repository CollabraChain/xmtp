import * as fs from "fs";
import {
  AgentKit,
  cdpApiActionProvider,
  CdpV2WalletProvider,
  cdpWalletActionProvider,
  erc20ActionProvider,
  walletActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import {
  createSigner,
  getEncryptionKeyFromHex,
  validateEnvironment,
} from "@helpers/client";
import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { TransactionReferenceCodec } from "@xmtp/content-type-transaction-reference";
import {
  ContentTypeWalletSendCalls,
  WalletSendCallsCodec,
  type WalletSendCallsParams,
} from "@xmtp/content-type-wallet-send-calls";
import { Client } from "@xmtp/node-sdk";
import { encodeFunctionData, parseUnits } from "viem";
import { z } from "zod";
import { CollabraChainFactoryABI } from "./contracts/CollabraChainFactory";
import { CollabraChainProjectABI } from "./contracts/CollabraChainProject";
import { CollabraChainReputationABI as _CollabraChainReputationABI } from "./contracts/CollabraChainReputation";

const {
  WALLET_KEY,
  ENCRYPTION_KEY,
  XMTP_ENV,
  NETWORK_ID,
  CDP_API_KEY_ID,
  CDP_API_KEY_SECRET,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
} = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY",
  "XMTP_ENV",
  "NETWORK_ID",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
]);

// Storage constants
const XMTP_STORAGE_DIR = ".data/xmtp";
const WALLET_STORAGE_DIR = ".data/wallet";

// CollabraChain contract addresses (Base)
const COLLABRA_CHAIN_FACTORY_ADDRESS =
  "0xfB250Bf4c8F9E80fEE15FF978ad1a6289dED9C2f";
const _USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913";

// Commands configuration
const COMMANDS = {
  // Project Management
  create: { name: "create", description: "Create a new project" },
  list: { name: "list", description: "List available projects" },
  apply: { name: "apply", description: "Apply to a project" },
  approve: { name: "approve", description: "Approve a freelancer application" },
  invite: { name: "invite", description: "Invite a freelancer directly" },
  dashboard: { name: "dashboard", description: "View your project dashboard" },

  // Milestone Management
  "add-milestone": {
    name: "add-milestone",
    description: "Add a milestone to project",
  },
  "fund-milestone": { name: "fund-milestone", description: "Fund a milestone" },
  "submit-work": {
    name: "submit-work",
    description: "Submit work for milestone",
  },
  "approve-work": {
    name: "approve-work",
    description: "Approve submitted work",
  },

  // Dispute & Reputation
  dispute: { name: "dispute", description: "Raise a dispute for milestone" },
  reputation: { name: "reputation", description: "View reputation and SBTs" },

  // General
  help: { name: "help", description: "Show available commands" },
};

const HELP_MESSAGE = `
🏗️ **CollabraChain Commands**

**📋 Project Management:**
• \`/create\` or \`@collab create\` - Create a new project with AI assistance
• \`/list\` - Browse available projects
• \`/apply <project_address>\` - Apply to join a project
• \`/approve <freelancer_address>\` - Approve freelancer application  
• \`/invite <freelancer_address>\` - Directly invite a freelancer
• \`/dashboard\` - View your projects status

**💰 Milestone & Payments:**
• \`/add-milestone <project_address> <description> <budget> <deadline>\` - Add milestone
• \`/fund-milestone <project_address> <milestone_id>\` - Fund milestone
• \`/submit-work <project_address> <milestone_id> <work_cid>\` - Submit work
• \`/approve-work <project_address> <milestone_id>\` - Approve work & release payment

**⚖️ Dispute & Reputation:**
• \`/dispute <project_address> <milestone_id> <reason>\` - Raise dispute
• \`/reputation [address]\` - View reputation/SBTs

**💬 AI Chat:**
Just chat naturally for AI-assisted project creation and management!

Type \`/help\` anytime to see this menu.
`;

/**
 * Ensure local storage directory exists
 */
function ensureLocalStorage() {
  if (!fs.existsSync(XMTP_STORAGE_DIR)) {
    fs.mkdirSync(XMTP_STORAGE_DIR, { recursive: true });
  }
  if (!fs.existsSync(WALLET_STORAGE_DIR)) {
    fs.mkdirSync(WALLET_STORAGE_DIR, { recursive: true });
  }
}

/**
 * Get wallet data from storage.
 */
function _getWalletData(userId: string): string | null {
  const localFilePath = `${WALLET_STORAGE_DIR}/${userId}.json`;
  try {
    if (fs.existsSync(localFilePath)) {
      return fs.readFileSync(localFilePath, "utf8");
    }
  } catch (error) {
    console.warn(`Could not read wallet data from file: ${error as string}`);
  }
  return null;
}

/**
 * Initialize the XMTP client.
 */
async function initializeXmtpClient() {
  const signer = createSigner(WALLET_KEY);
  const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

  const identifier = await signer.getIdentifier();
  const address = identifier.identifier;

  const client = await Client.create(signer, {
    dbEncryptionKey,
    env: "dev",
    dbPath: XMTP_STORAGE_DIR + `/${XMTP_ENV}-${address}`,
    codecs: [new TransactionReferenceCodec(), new WalletSendCallsCodec()],
  });

  const inboxId = client.inboxId;
  const environments = client.options?.env ?? "dev";

  console.log(`\x1b[38;2;252;76;52m
    ██╗  ██╗███╗   ███╗████████╗██████╗ 
    ╚██╗██╔╝████╗ ████║╚══██╔══╝██╔══██╗
     ╚███╔╝ ██╔████╔██║   ██║   ██████╔╝
     ██╔██╗ ██║╚██╔╝██║   ██║   ██╔═══╝ 
    ██╔╝ ██╗██║ ╚═╝ ██║   ██║   ██║     
    ╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝   ╚═╝     
  \x1b[0m`);

  const urls = [`http://xmtp.chat/dm/${address}`];
  const conversations = await client.conversations.list();
  const installations = await client.preferences.inboxState();

  console.log(`
✓ XMTP Client:
• Address: ${address}
• Installations: ${installations.installations.length}
• Conversations: ${conversations.length}
• InboxId: ${inboxId}
• Networks: ${environments}
${urls.map((url) => `• URL: ${url}`).join("\n")}`);

  console.log("✓ Syncing conversations...");
  await client.conversations.sync();

  return client;
}

/**
 * Parse command from message content
 */
function parseCommand(content: string): {
  command: string | null;
  args: string[];
} {
  const words = content.trim().split(/\s+/);
  const [firstWord, ...rest] = words;

  // Handle @collab prefix
  if (firstWord.toLowerCase() === "@collab") {
    return {
      command: rest[0].toLowerCase() || null,
      args: rest.slice(1),
    };
  }

  // Handle /command prefix
  if (firstWord.startsWith("/")) {
    return {
      command: firstWord.toLowerCase().replace("/", ""),
      args: rest,
    };
  }

  return { command: null, args: [] };
}

/**
 * Get user's ethereum address from inbox ID
 */
async function getUserAddress(
  client: Client,
  inboxId: string,
): Promise<string | null> {
  try {
    const inboxState = await client.preferences.inboxStateFromInboxIds([
      inboxId,
    ]);
    return inboxState[0]?.identifiers[0]?.identifier ?? null;
  } catch (error) {
    console.error("Error getting user address:", error);
    return null;
  }
}

/**
 * Main function to start the chatbot.
 */
async function main(): Promise<void> {
  const memory = new MemorySaver();
  console.log("Initializing CollabraChain Agent on XMTP...");

  ensureLocalStorage();

  // Initialize wallet provider
  const walletProvider = await CdpV2WalletProvider.configureWithWallet({
    apiKeyId: CDP_API_KEY_ID,
    apiKeySecret: CDP_API_KEY_SECRET,
    networkId: NETWORK_ID,
    walletSecret: `MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgT8a/v+9BXz3+QK36KpgTGnZfLWN9yRppw52QGZ1uDj+hRANCAAQPJmbZli6X1HTM9b5n8O3QW+lr0g4FJEa9OeAY7bEugrmy5DmRUMLGyTIP0g2m8lz9BIRH6HQfya/ln5IVpsId`,
  });

  const account = await walletProvider.getClient().evm.getOrCreateAccount({
    name: "Account1",
  });

  const smartAccount = await walletProvider
    .getClient()
    .evm.getOrCreateSmartAccount({
      name: "AGENT",
      owner: account,
    });

  const client = await initializeXmtpClient();

  // Initialize AgentKit
  const agentkit = await AgentKit.from({
    walletProvider,
    actionProviders: [
      walletActionProvider(),
      erc20ActionProvider(),
      cdpApiActionProvider({
        apiKeyId: CDP_API_KEY_ID,
        apiKeySecret: CDP_API_KEY_SECRET,
      }),
      cdpWalletActionProvider({
        apiKeyId: CDP_API_KEY_ID,
        apiKeySecret: CDP_API_KEY_SECRET,
      }),
    ],
  });

  const baseLangChainTools = await getLangChainTools(agentkit);

  const createProjectTool = tool(
    async (input) => {
      try {
        console.log("Creating project with input:", input);

        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: COLLABRA_CHAIN_FACTORY_ADDRESS,
              data: encodeFunctionData({
                abi: CollabraChainFactoryABI,
                functionName: "createProject",
                args: [
                  input.title,
                  input.description,
                  input.category,
                  input.skillsRequired,
                  parseUnits(input.totalBudget.toString(), 6),
                  BigInt(Math.floor(input.deadline / 1000)), // Convert to Unix timestamp
                  input.projectScopeCID || "",
                  input.xmtpRoomId || "",
                ],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Project created successfully! The creator should now fund the project escrow with USDC.",
          };
        } else {
          throw new Error("Project creation failed");
        }
      } catch (error) {
        console.error("Error creating project:", error);
        throw error;
      }
    },
    {
      name: "createProject",
      description: "Create a new decentralized project on CollabraChain",
      schema: z.object({
        title: z.string().describe("Project title"),
        description: z.string().describe("Project description"),
        category: z.string().describe("Project category"),
        skillsRequired: z.array(z.string()).describe("Required skills"),
        totalBudget: z.number().describe("Total budget in USDC"),
        deadline: z.number().describe("Project deadline as Unix timestamp"),
        projectScopeCID: z
          .string()
          .optional()
          .describe("IPFS CID for project scope"),
        xmtpRoomId: z
          .string()
          .optional()
          .describe("XMTP room ID for communication"),
      }),
    },
  );

  const listProjectsTool = tool(
    () => {
      try {
        return {
          success: true,
          projects: [
            {
              address: "0x123...",
              title: "DeFi Dashboard Development",
              category: "Frontend",
              budget: "5000 USDC",
              deadline: "Dec 31, 2024",
              creator: "0xabc...",
              status: "Open",
            },
          ],
          message: "Use the project address to apply with /apply command",
        };
      } catch (error) {
        console.error("Error listing projects:", error);
        throw error;
      }
    },
    {
      name: "listProjects",
      description: "List available projects for freelancers to discover",
      schema: z.object({
        category: z.string().optional().describe("Filter by category"),
      }),
    },
  );

  const applyToProjectTool = tool(
    async (input) => {
      try {
        const conversation = await client.conversations.getConversationById(
          input.conversationId,
        );

        const callCodec: WalletSendCallsParams = {
          chainId: "0x2105",
          version: "1",
          from: input.projectAddress as `0x${string}`,
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "applyProject",
                args: [],
              }),
              metadata: {
                description: "Apply to join a project as a freelancer",
                transactionType: "applyProject",
              },
            },
          ],
        };

        await conversation?.send(callCodec, ContentTypeWalletSendCalls);
      } catch (error) {
        console.error("Error applying to project:", error);
        throw error;
      }
    },
    {
      name: "applyToProject",
      description: "Apply to join a project as a freelancer",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        conversationId: z.string().describe("Conversation ID"),
      }),
    },
  );

  const approveFreelancerTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "approveFreelancer",
                args: [input.freelancerAddress as `0x${string}`],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Freelancer approved successfully! They can now work on the project.",
          };
        } else {
          throw new Error("Freelancer approval failed");
        }
      } catch (error) {
        console.error("Error approving freelancer:", error);
        throw error;
      }
    },
    {
      name: "approveFreelancer",
      description: "Approve a freelancer application for a project",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        freelancerAddress: z.string().describe("Freelancer wallet address"),
      }),
    },
  );

  // === MILESTONE MANAGEMENT TOOLS ===

  const addMilestoneTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "addMilestone",
                args: [
                  input.description,
                  parseUnits(input.budget.toString(), 6),
                  BigInt(Math.floor(input.deadline / 1000)),
                ],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Milestone added successfully! You can now fund it with /fund-milestone.",
          };
        } else {
          throw new Error("Adding milestone failed");
        }
      } catch (error) {
        console.error("Error adding milestone:", error);
        throw error;
      }
    },
    {
      name: "addMilestone",
      description: "Add a new milestone to a project",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        description: z.string().describe("Milestone description"),
        budget: z.number().describe("Milestone budget in USDC"),
        deadline: z.number().describe("Milestone deadline as Unix timestamp"),
      }),
    },
  );

  const submitWorkTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "submitWork",
                args: [
                  BigInt(input.milestoneId),
                  input.workSubmissionCID as `0x${string}`,
                ],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Work submitted successfully! Waiting for client approval.",
          };
        } else {
          throw new Error("Work submission failed");
        }
      } catch (error) {
        console.error("Error submitting work:", error);
        throw error;
      }
    },
    {
      name: "submitWork",
      description: "Submit work for a milestone",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        milestoneId: z.number().describe("Milestone ID"),
        workSubmissionCID: z.string().describe("IPFS CID of submitted work"),
      }),
    },
  );

  const approveWorkTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "releasePayment",
                args: [
                  BigInt(input.milestoneId),
                  input.creatorSbtCID || "",
                  input.freelancerSbtCID || "",
                ],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Work approved and payment released! SBT reputation tokens have been minted.",
          };
        } else {
          throw new Error("Work approval failed");
        }
      } catch (error) {
        console.error("Error approving work:", error);
        throw error;
      }
    },
    {
      name: "approveWork",
      description: "Approve submitted work and release milestone payment",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        milestoneId: z.number().describe("Milestone ID"),
        creatorSbtCID: z
          .string()
          .optional()
          .describe("Creator SBT metadata CID"),
        freelancerSbtCID: z
          .string()
          .optional()
          .describe("Freelancer SBT metadata CID"),
      }),
    },
  );

  const inviteFreelancerTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "inviteFreelancer",
                args: [input.freelancerAddress as `0x${string}`],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Freelancer invited successfully! They can now join the project directly.",
          };
        } else {
          throw new Error("Freelancer invitation failed");
        }
      } catch (error) {
        console.error("Error inviting freelancer:", error);
        throw error;
      }
    },
    {
      name: "inviteFreelancer",
      description: "Directly invite a specific freelancer to join a project",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        freelancerAddress: z
          .string()
          .describe("Freelancer wallet address to invite"),
      }),
    },
  );

  const fundMilestoneTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "fundMilestone",
                args: [BigInt(input.milestoneId)],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Milestone funded successfully! Freelancer can now start working on it.",
          };
        } else {
          throw new Error("Milestone funding failed");
        }
      } catch (error) {
        console.error("Error funding milestone:", error);
        throw error;
      }
    },
    {
      name: "fundMilestone",
      description: "Fund a specific milestone with USDC",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        milestoneId: z.number().describe("Milestone ID to fund"),
      }),
    },
  );

  const viewReputationTool = tool(
    (input) => {
      try {
        return {
          success: true,
          reputation: {
            address: input.userAddress,
            totalProjects: 5,
            completedProjects: 4,
            reputationScore: 85,
            sbtTokens: [
              {
                tokenId: 1,
                projectId: 1,
                role: "Creator",
                timestamp: "2024-01-15",
                metadataCID: "QmExample1...",
              },
              {
                tokenId: 2,
                projectId: 2,
                role: "Freelancer",
                timestamp: "2024-02-20",
                metadataCID: "QmExample2...",
              },
            ],
          },
          message: "Reputation data retrieved successfully",
        };
      } catch (error) {
        console.error("Error viewing reputation:", error);
        throw error;
      }
    },
    {
      name: "viewReputation",
      description:
        "View reputation score and Soul-Bound Tokens (SBTs) for a user",
      schema: z.object({
        userAddress: z
          .string()
          .describe("User wallet address to check reputation for"),
      }),
    },
  );

  // === DISPUTE & REPUTATION TOOLS ===

  const raiseDisputeTool = tool(
    async (input) => {
      try {
        const tx = await walletProvider.getClient().evm.sendUserOperation({
          smartAccount,
          network: "base",
          paymasterUrl:
            "https://api.developer.coinbase.com/rpc/v1/base/ysRNUL0e5tLaH0gTgLkD5BA8I8go4AGO",
          calls: [
            {
              to: input.projectAddress as `0x${string}`,
              data: encodeFunctionData({
                abi: CollabraChainProjectABI,
                functionName: "raiseDispute",
                args: [BigInt(input.milestoneId), input.reason],
              }),
            },
          ],
        });

        const userOperation = await walletProvider
          .getClient()
          .evm.waitForUserOperation({
            smartAccountAddress: smartAccount.address,
            userOpHash: tx.userOpHash,
          });

        if (userOperation.status === "complete") {
          return {
            success: true,
            transactionHash: userOperation.transactionHash,
            message:
              "Dispute raised successfully! An arbiter will review the case.",
          };
        } else {
          throw new Error("Dispute creation failed");
        }
      } catch (error) {
        console.error("Error raising dispute:", error);
        throw error;
      }
    },
    {
      name: "raiseDispute",
      description: "Raise a dispute for unsatisfactory work",
      schema: z.object({
        projectAddress: z.string().describe("Project contract address"),
        milestoneId: z.number().describe("Milestone ID"),
        reason: z.string().describe("Reason for the dispute"),
      }),
    },
  );

  // Combine all tools - let TypeScript infer the type
  const allTools = [
    ...baseLangChainTools,
    createProjectTool,
    listProjectsTool,
    applyToProjectTool,
    approveFreelancerTool,
    inviteFreelancerTool,
    addMilestoneTool,
    fundMilestoneTool,
    submitWorkTool,
    approveWorkTool,
    viewReputationTool,
    raiseDisputeTool,
  ];

  // Create the agent
  const llm = new ChatBedrockConverse({
    model: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    region: AWS_REGION,
    credentials: {
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
    },
  });
  const agent = createReactAgent({
    llm,
    tools: allTools as Parameters<typeof createReactAgent>[0]["tools"],
    checkpointSaver: memory,
    messageModifier: `
You are the CollabraChain Agent, a specialized AI assistant for decentralized freelance project management on the Base blockchain.

🏗️ **Your Capabilities:**

**Project Management:**
- Create projects with detailed specifications
- Help freelancers discover and apply to projects  
- Assist creators in reviewing and approving applications
- Manage project dashboards and status tracking

**Milestone & Payment System:**
- Add and structure project milestones
- Handle milestone funding with USDC
- Process work submissions and approvals
- Automatically release payments upon approval
- Mint Soul-Bound Token (SBT) reputation rewards

**Dispute Resolution:**
- Facilitate dispute creation for unsatisfactory work
- Guide users through arbitration processes

**AI-Powered Assistance:**
- Provide natural language project creation
- Suggest optimal milestone structures
- Guide users through complex workflows
- Explain blockchain interactions in simple terms

**Key Guidelines:**
- Always use Base network with USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913)
- Verify user authorization for sensitive operations
- Provide clear step-by-step instructions
- Explain costs and gas fees transparently
- Guide users to fund escrows after project creation
- Celebrate successful completions and reputation gains

When users send commands like /create, /list, /apply, etc., use the appropriate tools. For natural conversation, assist with project planning and management advice.
    `,
  });

  // Start listening for messages
  console.log("🚀 CollabraChain Agent is ready! Waiting for messages...");
  const stream = await client.conversations.streamAllMessages();

  for await (const message of stream) {
    if (!message) continue;

    // Skip messages from the agent itself or non-text messages
    if (
      message.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message.contentType?.typeId !== "text"
    ) {
      console.log(message);
      continue;
    }

    const content = message.content as string;

    console.log(`📨 Received: ${content} from ${message.senderInboxId}`);

    const conversation = await client.conversations.getConversationById(
      message.conversationId,
    );
    if (!conversation) {
      console.log("❌ Could not find conversation");
      continue;
    }

    const userId = message.senderInboxId.toLowerCase();
    const messageContent = message.content as string;
    const userAddress = await getUserAddress(
      client as Client,
      message.senderInboxId,
    );

    try {
      // Parse command
      const { command, args } = parseCommand(messageContent);

      // Handle help command directly
      if (command === "help") {
        await conversation.send(HELP_MESSAGE);
        continue;
      }

      // Handle commands with direct responses
      if (command && Object.keys(COMMANDS).includes(command)) {
        console.log(`🔧 Processing command: ${command} with args:`, args);

        // For some commands, provide direct responses without invoking the agent
        switch (command) {
          case "list":
            if (args.length === 0) {
              // Use the agent for complex listing
              break;
            }
            // Simple list command
            await conversation.send("📋 Fetching available projects...");
            break;

          case "dashboard":
            await conversation.send(
              `📊 **Your Dashboard** (${userAddress})\n\n🔸 Projects Created: Loading...\n🔸 Active Applications: Loading...\n🔸 Completed Projects: Loading...\n🔸 Reputation Score: Loading...\n\nUse specific commands to manage your projects!`,
            );
            continue;

          default:
            // Let the agent handle complex commands
            break;
        }
      }

      const messageInformation = {
        userId,
        messageContent,
        userAddress,
        command,
        args,
        conversationId: message.conversationId,
      };
      // Invoke the agent for all messages
      console.log("🤖 Invoking agent for:", userId);
      const response = await agent.invoke(
        {
          messages: [
            new HumanMessage(JSON.stringify(messageInformation)),
            new HumanMessage(messageContent),
          ],
        },
        {
          configurable: {
            thread_id: userId,
          },
        },
      );

      // Send the agent's response
      const lastMessage = response.messages[response.messages.length - 1];
      if (lastMessage.content) {
        const content =
          typeof lastMessage.content === "string"
            ? lastMessage.content
            : JSON.stringify(lastMessage.content);
        await conversation.send(content);
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("❌ Error processing message:", errorMessage);

      await conversation.send(
        `❌ Sorry, I encountered an error: ${errorMessage}\n\n${HELP_MESSAGE}`,
      );
    }
  }
}

// Start the agent
main().catch(console.error);
