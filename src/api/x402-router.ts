import { Router } from "express";
import {
  getPaymentStatus,
  processAIProjectCreation,
  processDisputeCreation,
  processMilestoneApproval,
  processProjectApplication,
  requestAIProjectCreation,
  requestDisputeCreation,
  requestMilestoneApproval,
  requestProjectApplication,
} from "./x402-endpoints.js";

const router = Router();

// Middleware for request validation and type safety
const validateRequiredFields = (fields: string[]) => {
  return (req: any, res: any, next: any) => {
    const missing = fields.filter((field) => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(", ")}`,
      });
    }
    next();
  };
};

// 🤖 AI-Assisted Project Creation Routes
router.post(
  "/ai-project/request",
  validateRequiredFields(["userId"]),
  requestAIProjectCreation,
);

router.post(
  "/ai-project/process",
  validateRequiredFields(["paymentId", "transactionHash"]),
  processAIProjectCreation,
);

// 📝 Project Application Routes
router.post(
  "/application/request",
  validateRequiredFields(["userId", "projectAddress"]),
  requestProjectApplication,
);

router.post(
  "/application/process",
  validateRequiredFields(["paymentId", "transactionHash"]),
  processProjectApplication,
);

// ✅ Milestone Approval Routes
router.post(
  "/milestone/request",
  validateRequiredFields(["userId", "projectAddress", "milestoneId"]),
  requestMilestoneApproval,
);

router.post(
  "/milestone/process",
  validateRequiredFields(["paymentId", "transactionHash"]),
  processMilestoneApproval,
);

// ⚖️ Dispute Resolution Routes
router.post(
  "/dispute/request",
  validateRequiredFields([
    "userId",
    "projectAddress",
    "milestoneId",
    "disputeReason",
  ]),
  requestDisputeCreation,
);

router.post(
  "/dispute/process",
  validateRequiredFields(["paymentId", "transactionHash"]),
  processDisputeCreation,
);

// 📊 Payment Status Route
router.get("/payment/:paymentId", getPaymentStatus);

// 💰 Payment Pricing Information
router.get("/pricing", (req, res) => {
  res.json({
    scenarios: {
      AI_PROJECT_CREATION: {
        amount: "1.00 USDC",
        description:
          "AI-assisted project creation with complete draft and milestones",
        duration: "Instant",
      },
      APPLICATION_SIGNAL_FEE: {
        amount: "0.50 USDC",
        description: "Anti-spam signal fee for serious project applications",
        duration: "Instant",
      },
      MILESTONE_APPROVAL_FEE: {
        amount: "2.00 USDC",
        description: "Service fee for milestone approval and SBT minting",
        duration: "Instant",
      },
      DISPUTE_BOND: {
        amount: "10.00 USDC",
        description: "Dispute resolution bond with human arbiter assignment",
        duration: "24-48 hours",
      },
    },
    paymentMethods: ["USDC", "ETH"],
    network: "Base",
    facilitator: "x402.xyz",
  });
});

// 🏥 Health Check
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "x402-payment-gateway",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

export default router;
