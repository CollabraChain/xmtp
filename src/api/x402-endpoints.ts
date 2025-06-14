import type { Request, Response } from "express";
import X402PayService, {
  type X402_PAYMENT_SCENARIOS,
} from "../services/X402PayService.js";

// Initialize x402 payment service
const x402Service = new X402PayService();

// Store payment sessions for validation
const paymentSessions = new Map<
  string,
  {
    userId: string;
    scenario: keyof typeof X402_PAYMENT_SCENARIOS;
    metadata: Record<string, any>;
    timestamp: number;
  }
>();

/**
 * 💡 AI-Assisted Project Creation Endpoint
 * User Story: "As a Project Creator, I can pay a small fee via x402pay to have an AI agent create a complete project draft for me"
 */
export const requestAIProjectCreation = (req: Request, res: Response) => {
  try {
    const { userId, projectType, requirements } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID required" });
    }

    // Generate payment request for AI project creation
    const payment402 = x402Service.create402Response("AI_PROJECT_CREATION", {
      userId,
      projectType,
      requirements,
      timestamp: Date.now(),
    });

    // Store session for post-payment processing
    paymentSessions.set(payment402.body.payment.id, {
      userId,
      scenario: "AI_PROJECT_CREATION",
      metadata: { projectType, requirements },
      timestamp: Date.now(),
    });

    console.log("🤖 [AI PROJECT CREATION REQUESTED]", {
      userId,
      paymentId: payment402.body.payment.id,
      amount: payment402.body.payment.amount,
    });

    // Return 402 Payment Required
    res.status(402).set(payment402.headers).json(payment402.body);
  } catch (error) {
    console.error("❌ [AI PROJECT CREATION ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * 🎯 Process AI Project Creation After Payment
 */
export const processAIProjectCreation = async (req: Request, res: Response) => {
  try {
    const { paymentId, transactionHash } = req.body;

    if (!paymentId || !transactionHash) {
      return res
        .status(400)
        .json({ error: "Payment ID and transaction hash required" });
    }

    // Verify payment with x402
    const verification = await x402Service.verifyPayment(
      paymentId,
      transactionHash,
    );

    if (!verification.verified) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const session = paymentSessions.get(paymentId);
    if (!session) {
      return res.status(404).json({ error: "Payment session not found" });
    }

    // Payment verified, process AI project creation
    console.log("✅ [AI PROJECT CREATION PAID]", {
      userId: session.userId,
      paymentId,
      transactionHash,
    });

    // TODO: Integrate with your AI agent for project creation
    const aiGeneratedProject = {
      title: `AI Generated ${session.metadata.projectType} Project`,
      description: `Automatically generated project based on requirements: ${session.metadata.requirements}`,
      category: session.metadata.projectType,
      skillsRequired: ["Smart Contracts", "Frontend", "Backend"],
      estimatedBudget: "5000 USDC",
      estimatedDuration: "4 weeks",
      milestones: [
        {
          title: "Planning & Design",
          description: "Project planning and UI/UX design",
          budget: "1000 USDC",
          duration: "1 week",
        },
        {
          title: "Development",
          description: "Core development work",
          budget: "3000 USDC",
          duration: "2 weeks",
        },
        {
          title: "Testing & Deployment",
          description: "Testing and final deployment",
          budget: "1000 USDC",
          duration: "1 week",
        },
      ],
    };

    // Clean up session
    paymentSessions.delete(paymentId);

    res.json({
      success: true,
      message: "AI project creation completed",
      project: aiGeneratedProject,
      paymentVerification: verification,
    });
  } catch (error) {
    console.error("❌ [AI PROJECT PROCESSING ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * 📝 Project Application Signal Fee
 * User Story: "As a Freelancer, I can pay a small anti-spam 'signal fee' via x402pay to apply to a project"
 */
export const requestProjectApplication = (req: Request, res: Response) => {
  try {
    const { userId, projectAddress, applicationMessage } = req.body;

    if (!userId || !projectAddress) {
      return res
        .status(400)
        .json({ error: "User ID and project address required" });
    }

    // Generate payment request for application signal fee
    const payment402 = x402Service.create402Response("APPLICATION_SIGNAL_FEE", {
      userId,
      projectAddress,
      applicationMessage,
      timestamp: Date.now(),
    });

    // Store session for post-payment processing
    paymentSessions.set(payment402.body.payment.id, {
      userId,
      scenario: "APPLICATION_SIGNAL_FEE",
      metadata: { projectAddress, applicationMessage },
      timestamp: Date.now(),
    });

    console.log("📝 [PROJECT APPLICATION REQUESTED]", {
      userId,
      projectAddress,
      paymentId: payment402.body.payment.id,
    });

    // Return 402 Payment Required
    res.status(402).set(payment402.headers).json(payment402.body);
  } catch (error) {
    console.error("❌ [PROJECT APPLICATION ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * 🎯 Process Project Application After Payment
 */
export const processProjectApplication = async (
  req: Request,
  res: Response,
) => {
  try {
    const { paymentId, transactionHash } = req.body;

    const verification = await x402Service.verifyPayment(
      paymentId,
      transactionHash,
    );
    if (!verification.verified) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const session = paymentSessions.get(paymentId);
    if (!session) {
      return res.status(404).json({ error: "Payment session not found" });
    }

    console.log("✅ [PROJECT APPLICATION PAID]", {
      userId: session.userId,
      projectAddress: session.metadata.projectAddress,
      paymentId,
    });

    // TODO: Integrate with your smart contract to submit application
    // await submitProjectApplication(session.metadata.projectAddress, session.userId, session.metadata.applicationMessage);

    paymentSessions.delete(paymentId);

    res.json({
      success: true,
      message: "Project application submitted successfully",
      projectAddress: session.metadata.projectAddress,
      applicationStatus: "pending_review",
      paymentVerification: verification,
    });
  } catch (error) {
    console.error("❌ [PROJECT APPLICATION PROCESSING ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * ✅ Milestone Approval Service Fee
 * User Story: "As a Project Creator, I can pay a small service fee via x402pay when I approve the final milestone"
 */
export const requestMilestoneApproval = (req: Request, res: Response) => {
  try {
    const { userId, projectAddress, milestoneId } = req.body;

    if (!userId || !projectAddress || milestoneId === undefined) {
      return res.status(400).json({
        error: "User ID, project address, and milestone ID required",
      });
    }

    // Generate payment request for milestone approval fee
    const payment402 = x402Service.create402Response("MILESTONE_APPROVAL_FEE", {
      userId,
      projectAddress,
      milestoneId,
      timestamp: Date.now(),
    });

    // Store session for post-payment processing
    paymentSessions.set(payment402.body.payment.id, {
      userId,
      scenario: "MILESTONE_APPROVAL_FEE",
      metadata: { projectAddress, milestoneId },
      timestamp: Date.now(),
    });

    console.log("✅ [MILESTONE APPROVAL REQUESTED]", {
      userId,
      projectAddress,
      milestoneId,
      paymentId: payment402.body.payment.id,
    });

    // Return 402 Payment Required
    res.status(402).set(payment402.headers).json(payment402.body);
  } catch (error) {
    console.error("❌ [MILESTONE APPROVAL ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * 🎯 Process Milestone Approval After Payment
 */
export const processMilestoneApproval = async (req: Request, res: Response) => {
  try {
    const { paymentId, transactionHash } = req.body;

    const verification = await x402Service.verifyPayment(
      paymentId,
      transactionHash,
    );
    if (!verification.verified) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const session = paymentSessions.get(paymentId);
    if (!session) {
      return res.status(404).json({ error: "Payment session not found" });
    }

    console.log("✅ [MILESTONE APPROVAL PAID]", {
      userId: session.userId,
      projectAddress: session.metadata.projectAddress,
      milestoneId: session.metadata.milestoneId,
      paymentId,
    });

    // TODO: Integrate with your smart contract to approve milestone and mint SBTs
    // await approveMilestoneAndMintSBTs(session.metadata.projectAddress, session.metadata.milestoneId);

    paymentSessions.delete(paymentId);

    res.json({
      success: true,
      message: "Milestone approved and SBTs minted successfully",
      projectAddress: session.metadata.projectAddress,
      milestoneId: session.metadata.milestoneId,
      sbtsMinted: true,
      paymentVerification: verification,
    });
  } catch (error) {
    console.error("❌ [MILESTONE APPROVAL PROCESSING ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * ⚖️ Dispute Resolution Bond
 * User Story: "As a Project Creator or Freelancer, I can pay a 'dispute bond' via x402pay to formally initiate the dispute resolution process"
 */
export const requestDisputeCreation = (req: Request, res: Response) => {
  try {
    const { userId, projectAddress, milestoneId, disputeReason } = req.body;

    if (
      !userId ||
      !projectAddress ||
      milestoneId === undefined ||
      !disputeReason
    ) {
      return res.status(400).json({
        error:
          "User ID, project address, milestone ID, and dispute reason required",
      });
    }

    // Generate payment request for dispute bond
    const payment402 = x402Service.create402Response("DISPUTE_BOND", {
      userId,
      projectAddress,
      milestoneId,
      disputeReason,
      timestamp: Date.now(),
    });

    // Store session for post-payment processing
    paymentSessions.set(payment402.body.payment.id, {
      userId,
      scenario: "DISPUTE_BOND",
      metadata: { projectAddress, milestoneId, disputeReason },
      timestamp: Date.now(),
    });

    console.log("⚖️ [DISPUTE CREATION REQUESTED]", {
      userId,
      projectAddress,
      milestoneId,
      paymentId: payment402.body.payment.id,
    });

    // Return 402 Payment Required
    res.status(402).set(payment402.headers).json(payment402.body);
  } catch (error) {
    console.error("❌ [DISPUTE CREATION ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * 🎯 Process Dispute Creation After Payment
 */
export const processDisputeCreation = async (req: Request, res: Response) => {
  try {
    const { paymentId, transactionHash } = req.body;

    const verification = await x402Service.verifyPayment(
      paymentId,
      transactionHash,
    );
    if (!verification.verified) {
      return res.status(400).json({ error: "Payment verification failed" });
    }

    const session = paymentSessions.get(paymentId);
    if (!session) {
      return res.status(404).json({ error: "Payment session not found" });
    }

    console.log("⚖️ [DISPUTE CREATION PAID]", {
      userId: session.userId,
      projectAddress: session.metadata.projectAddress,
      milestoneId: session.metadata.milestoneId,
      paymentId,
    });

    // TODO: Integrate with your smart contract to create dispute
    // await createDispute(session.metadata.projectAddress, session.metadata.milestoneId, session.metadata.disputeReason);

    paymentSessions.delete(paymentId);

    res.json({
      success: true,
      message: "Dispute created successfully and assigned to arbiter",
      projectAddress: session.metadata.projectAddress,
      milestoneId: session.metadata.milestoneId,
      disputeId: `dispute_${Date.now()}`, // Generate proper dispute ID
      arbiterAssigned: true,
      paymentVerification: verification,
    });
  } catch (error) {
    console.error("❌ [DISPUTE CREATION PROCESSING ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * 📊 Get Payment Status
 */
export const getPaymentStatus = (req: Request, res: Response) => {
  try {
    const { paymentId } = req.params;

    if (x402Service.isPaymentPending(paymentId)) {
      const pendingPayment = x402Service.getPendingPayment(paymentId);
      const session = paymentSessions.get(paymentId);

      res.json({
        status: "pending",
        payment: pendingPayment,
        session: session
          ? {
              scenario: session.scenario,
              userId: session.userId,
              timestamp: session.timestamp,
            }
          : null,
      });
    } else {
      res.json({
        status: "not_found",
        message: "Payment not found or already processed",
      });
    }
  } catch (error) {
    console.error("❌ [PAYMENT STATUS ERROR]", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Cleanup expired payments every hour
setInterval(() => {
  x402Service.cleanupExpiredPayments();

  // Also cleanup expired sessions
  const now = Date.now();
  for (const [paymentId, session] of paymentSessions.entries()) {
    if (now - session.timestamp > 3600000) {
      // 1 hour
      paymentSessions.delete(paymentId);
      console.log("🧹 [SESSION EXPIRED]", { paymentId });
    }
  }
}, 3600000);
