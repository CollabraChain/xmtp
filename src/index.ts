import * as fs from "fs";
import {
  AgentKit,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  CdpWalletProvider,
  erc20ActionProvider,
  walletActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import {
  createSigner,
  getEncryptionKeyFromHex,
  logAgentDetails,
  validateEnvironment,
} from "@helpers/client";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import {
  Client,
  type Conversation,
  type DecodedMessage,
  type XmtpEnv,
} from "@xmtp/node-sdk";
import { z } from "zod";
import { ethers } from "ethers";
import CollabraChainFactoryABI from "./contracts/CollabraChainFactoryABI.json" assert { type: "json" };
import CollabraChainProjectABI from "./contracts/CollabraChainProjectABI.json" assert { type: "json" };
import type { ContractTransactionReceipt, Log } from "ethers";
import type { StructuredTool } from "@langchain/core/tools";

const {
  WALLET_KEY,
  ENCRYPTION_KEY,
  XMTP_ENV,
  NETWORK_ID,
  CDP_API_KEY_ID,
  CDP_API_KEY_SECRET,
} = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY",
  "XMTP_ENV",
  "NETWORK_ID",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
]);

// Storage constants
const XMTP_STORAGE_DIR = ".data/xmtp";
const WALLET_STORAGE_DIR = ".data/wallet";

// Global stores for memory and agent instances
const memoryStore: Record<string, MemorySaver> = {};
const agentStore: Record<string, Agent> = {};

interface AgentConfig {
  configurable: {
    thread_id: string;
  };
}

type Agent = ReturnType<typeof createReactAgent>;

// CollabraChain contract addresses (Base)
const COLLABRA_CHAIN_FACTORY_ADDRESS =
  "0xfB250Bf4c8F9E80fEE15FF978ad1a6289dED9C2f";

// --- Tool 1: createProjectTool ---
const createProjectTool = {
  schema: z.object({
    clientAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address."),
    freelancerAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address."),
    milestoneDescriptions: z
      .array(z.string(), { required_error: "Milestone descriptions required" })
      .nonempty("At least one milestone required."),
    milestoneAmounts: z
      .array(z.string(), { required_error: "Milestone amounts required" })
      .nonempty("At least one milestone amount required."),
  }),
  name: "createProject",
  description:
    "Use this tool to create a new collaboration project smart contract. You must provide the client's wallet address, the freelancer's wallet address, and lists of milestone descriptions and their corresponding payment amounts.",
  returnDirect: true,
  invoke: async ({
    clientAddress,
    freelancerAddress,
    milestoneDescriptions,
    milestoneAmounts,
  }: {
    clientAddress: string;
    freelancerAddress: string;
    milestoneDescriptions: string[];
    milestoneAmounts: string[];
  }) => {
    try {
      // Use AgentKit's wallet provider or fallback to XMTP wallet
      // For demo, use XMTP wallet key (WALLET_KEY)
      const provider = ethers.getDefaultProvider(
        process.env.NETWORK_ID || "base-sepolia",
      );
      const signer = new ethers.Wallet(WALLET_KEY, provider);
      const factory = new ethers.Contract(
        COLLABRA_CHAIN_FACTORY_ADDRESS,
        CollabraChainFactoryABI,
        signer,
      );
      // Convert milestoneAmounts to BigNumber[]
      const amounts = milestoneAmounts.map((amt: string) =>
        ethers.parseUnits(amt, 6),
      );
      const receipt: ContractTransactionReceipt | null =
        await factory.createProject(
          clientAddress,
          freelancerAddress,
          milestoneDescriptions,
          amounts,
        );

      // Find the ProjectCreated event
      let projectAddress: string | null = null;
      if (receipt && Array.isArray(receipt.logs)) {
        for (const log of receipt.logs as Log[]) {
          try {
            const parsed = factory.interface.parseLog(log);
            if (
              parsed &&
              parsed.name === "ProjectCreated" &&
              typeof parsed.args.projectAddress === "string"
            ) {
              projectAddress = parsed.args.projectAddress;
              break;
            }
          } catch {
            continue;
          }
        }
      }
      if (projectAddress) {
        return `Successfully created project contract at address: ${projectAddress}`;
      } else {
        return "Project created, but could not determine new contract address.";
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error creating project: ${errorMessage}`;
    }
  },
};

// --- Tool 2: approveMilestoneTool ---
const approveMilestoneTool = {
  schema: z.object({
    projectAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address."),
    milestoneId: z.number().int().positive(),
  }),
  name: "approveMilestone",
  description:
    "Use this tool to approve a project milestone. You need the project contract's address and the milestone number (ID). This will release the escrowed funds for that milestone to the freelancer.",
  returnDirect: true,
  invoke: async ({
    projectAddress,
    milestoneId,
  }: {
    projectAddress: string;
    milestoneId: number;
  }) => {
    try {
      // Use AgentKit's wallet provider or fallback to XMTP wallet
      const provider = ethers.getDefaultProvider(
        process.env.NETWORK_ID || "base-sepolia",
      );
      const signer = new ethers.Wallet(WALLET_KEY, provider);
      const project = new ethers.Contract(
        projectAddress,
        CollabraChainProjectABI,
        signer,
      );
      // Authorization: Only the client can approve
      const clientAddress = (await project.client()) as string;
      const signerAddress = await signer.getAddress();
      if (signerAddress.toLowerCase() !== clientAddress.toLowerCase()) {
        return "Error: You are not authorized to approve milestones for this project.";
      }
      // Call approveAndPayMilestone (completionURI can be empty for now)
      await project.approveAndPayMilestone(milestoneId, "");
      return `Success! Milestone ${milestoneId} has been approved and payment has been sent.`;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `Error approving milestone: ${errorMessage}`;
    }
  },
};

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
 * Save wallet data to storage.
 *
 * @param userId - The unique identifier for the user
 * @param walletData - The wallet data to be saved
 */
function saveWalletData(userId: string, walletData: string) {
  const localFilePath = `${WALLET_STORAGE_DIR}/${userId}.json`;
  try {
    if (!fs.existsSync(localFilePath)) {
      console.log(`Wallet data saved for user ${userId}`);
      fs.writeFileSync(localFilePath, walletData);
    }
  } catch (error) {
    console.error(`Failed to save wallet data to file: ${error as string}`);
  }
}

/**
 * Get wallet data from storage.
 *
 * @param userId - The unique identifier for the user
 * @returns The wallet data as a string, or null if not found
 */
function getWalletData(userId: string): string | null {
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
 *
 * @returns An initialized XMTP Client instance
 */
async function initializeXmtpClient() {
  const signer = createSigner(WALLET_KEY);
  const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

  const identifier = await signer.getIdentifier();
  const address = identifier.identifier;

  const client = await Client.create(signer, {
    dbEncryptionKey,
    env: XMTP_ENV as XmtpEnv,
    dbPath: XMTP_STORAGE_DIR + `/${XMTP_ENV}-${address}`,
  });

  void logAgentDetails(client);

  /* Sync the conversations from the network to update the local db */
  console.log("✓ Syncing conversations...");
  await client.conversations.sync();

  return client;
}

/**
 * Initialize the agent with CDP Agentkit.
 *
 * @param userId - The unique identifier for the user
 * @returns The initialized agent and its configuration
 */
async function initializeAgent(
  userId: string,
): Promise<{ agent: Agent; config: AgentConfig }> {
  try {
    const llm = new ChatOpenAI({
      model: "gpt-4.1-mini",
    });

    const storedWalletData = getWalletData(userId);
    console.log(
      `Wallet data for ${userId}: ${storedWalletData ? "Found" : "Not found"}`,
    );

    const config = {
      apiKeyId: CDP_API_KEY_ID,
      apiKeySecret: CDP_API_KEY_SECRET,
      cdpWalletData: storedWalletData || undefined,
      networkId: NETWORK_ID || "base-sepolia",
    };

    const walletProvider = await CdpWalletProvider.configureWithWallet(config);

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

    const tools = await getLangChainTools(agentkit);
    // Add CollabraChain tools
    tools.push(createProjectTool as unknown as StructuredTool);
    tools.push(approveMilestoneTool as unknown as StructuredTool);

    memoryStore[userId] = new MemorySaver();

    const agentConfig: AgentConfig = {
      configurable: { thread_id: userId },
    };

    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memoryStore[userId],
      messageModifier: `
          You are the CollabraChain Project Agent, a specialized AI assistant for creating and managing decentralized work agreements on-chain.
          You interact with the CollabraChain smart contracts on the Base blockchain using Coinbase Developer Platform AgentKit.
  
          When a user wants to CREATE a new project:
          1. First, gather all necessary details: the client's wallet address, the freelancer's wallet address, and a clear list of milestone descriptions and their corresponding payment amounts in USDC.
          2. Use the 'createProject' tool to deploy the smart contract on Base.
          3. Once the project contract is created, clearly announce its address in the chat and explicitly instruct the CLIENT to fund the project's escrow with the total USDC amount.
  
          When a user wants to APPROVE a milestone:
          1. The 'approveMilestone' tool will automatically verify that the user making the request is the authorized client for that project.
          2. After you use the 'approveMilestone' tool, announce the successful payment release to all parties in the chat. For example: "Success! Milestone 1 has been approved and payment has been sent to the freelancer."
  
          IMPORTANT:
          Your default and only network is Base Mainnet. All financial transactions use USDC (address: 0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913).
          Your purpose is to facilitate project agreements through the CollabraChain protocol. You cannot act as a personal wallet or send arbitrary payments.
  
          Be professional, clear, and security-focused in all your interactions. For any requests outside of CollabraChain project management, politely explain that you are a specialized agent for managing on-chain work agreements and cannot assist with other tasks.
      `,
    });
    agentStore[userId] = agent;

    const exportedWallet = await walletProvider.exportWallet();
    const walletDataJson = JSON.stringify(exportedWallet);
    saveWalletData(userId, walletDataJson);

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

/**
 * Process a message with the agent.
 *
 * @param agent - The agent instance to process the message
 * @param config - The agent configuration
 * @param message - The message to process
 * @returns The processed response as a string
 */
async function processMessage(
  agent: Agent,
  config: AgentConfig,
  message: string,
): Promise<string> {
  let response = "";

  try {
    const stream = await agent.stream(
      { messages: [new HumanMessage(message)] },
      config,
    );

    for await (const chunk of stream) {
      const agentChunk = chunk as {
        agent: { messages: Array<{ content: unknown }> };
      };
      response += String(agentChunk.agent.messages[0].content) + "\n";
    }

    return response.trim();
  } catch (error) {
    console.error("Error processing message:", error);
    return "Sorry, I encountered an error while processing your request. Please try again later.";
  }
}

/**
 * Handle incoming XMTP messages.
 *
 * @param message - The decoded XMTP message
 * @param client - The XMTP client instance
 */
async function handleMessage(message: DecodedMessage, client: Client) {
  let conversation: Conversation | null = null;
  try {
    const senderAddress = message.senderInboxId;
    const botAddress = client.inboxId.toLowerCase();

    // Ignore messages from the bot itself
    if (senderAddress.toLowerCase() === botAddress) {
      return;
    }

    console.log(
      `Received message from ${senderAddress}: ${message.content as string}`,
    );

    const { agent, config } = await initializeAgent(senderAddress);
    const response = await processMessage(
      agent,
      config,
      String(message.content),
    );

    // Get the conversation and send response
    conversation = (await client.conversations.getConversationById(
      message.conversationId,
    )) as Conversation | null;
    if (!conversation) {
      throw new Error(
        `Could not find conversation for ID: ${message.conversationId}`,
      );
    }
    await conversation.send(response);
    console.debug(`Sent response to ${senderAddress}: ${response}`);
  } catch (error) {
    console.error("Error handling message:", error);
    if (conversation) {
      await conversation.send(
        "I encountered an error while processing your request. Please try again later.",
      );
    }
  }
}

/**
 * Start listening for XMTP messages.
 *
 * @param client - The XMTP client instance
 */
async function startMessageListener(client: Client) {
  console.log("Starting message listener...");
  const stream = await client.conversations.streamAllMessages();
  for await (const message of stream) {
    if (message) {
      await handleMessage(message, client);
    }
  }
}

/**
 * Main function to start the chatbot.
 */
async function main(): Promise<void> {
  console.log("Initializing Agent on XMTP...");

  ensureLocalStorage();

  const xmtpClient = await initializeXmtpClient();
  await startMessageListener(xmtpClient);
}

// Start the chatbot
main().catch(console.error);
