import { randomBytes } from "crypto";
import { v4 as uuidv4 } from "uuid";

// x402 Payment Types
export interface X402PaymentRequest {
  amount: string; // Amount in wei or smallest unit
  currency: "ETH" | "USDC" | "BASE";
  recipient: string; // Wallet address to receive payment
  description: string;
  metadata?: Record<string, any>;
}

export interface X402PaymentResponse {
  paymentId: string;
  amount: string;
  currency: string;
  recipient: string;
  deadline: number; // Unix timestamp
  nonce: string;
  signature?: string;
}

export interface X402PaymentVerification {
  paymentId: string;
  transactionHash: string;
  verified: boolean;
  amount: string;
  timestamp: number;
}

interface X402VerificationResult {
  verified: boolean;
  amount?: string;
  reason?: string;
}

// Payment scenarios with pricing
export const X402_PAYMENT_SCENARIOS = {
  AI_PROJECT_CREATION: {
    amount: "1000000", // 1 USDC (6 decimals)
    currency: "USDC" as const,
    description: "AI-Assisted Project Creation",
  },
  APPLICATION_SIGNAL_FEE: {
    amount: "500000", // 0.5 USDC
    currency: "USDC" as const,
    description: "Project Application Signal Fee",
  },
  MILESTONE_APPROVAL_FEE: {
    amount: "2000000", // 2 USDC
    currency: "USDC" as const,
    description: "Milestone Approval Service Fee",
  },
  DISPUTE_BOND: {
    amount: "10000000", // 10 USDC
    currency: "USDC" as const,
    description: "Dispute Resolution Bond",
  },
} as const;

export class X402PayService {
  private facilitatorUrl: string;
  private recipientAddress: string;
  private pendingPayments: Map<string, X402PaymentResponse> = new Map();

  constructor(
    facilitatorUrl: string = "https://facilitator.x402.xyz",
    recipientAddress: string = process.env.PLATFORM_WALLET_ADDRESS ||
      "0x742d35Cc6635C0532925a3b8D716C4C3e4d4Cc62",
  ) {
    this.facilitatorUrl = facilitatorUrl;
    this.recipientAddress = recipientAddress;
  }

  /**
   * Generate x402 payment request for a specific scenario
   */
  generatePaymentRequest(
    scenario: keyof typeof X402_PAYMENT_SCENARIOS,
    _metadata?: Record<string, any>,
  ): X402PaymentResponse {
    const config = X402_PAYMENT_SCENARIOS[scenario];
    const paymentId = uuidv4();
    const nonce = randomBytes(32).toString("hex");
    const deadline = Math.floor(Date.now() / 1000) + 3600; // 1 hour expiry

    const paymentRequest: X402PaymentResponse = {
      paymentId,
      amount: config.amount,
      currency: config.currency,
      recipient: this.recipientAddress,
      deadline,
      nonce,
    };

    // Store payment request for verification
    this.pendingPayments.set(paymentId, paymentRequest);

    console.log("💳 [X402 PAYMENT GENERATED]", {
      scenario,
      paymentId,
      amount: config.amount,
      currency: config.currency,
      description: config.description,
      deadline: new Date(deadline * 1000).toISOString(),
    });

    return paymentRequest;
  }

  /**
   * Create HTTP 402 Payment Required response
   */
  create402Response(
    scenario: keyof typeof X402_PAYMENT_SCENARIOS,
    metadata?: Record<string, any>,
  ) {
    const paymentRequest = this.generatePaymentRequest(scenario, metadata);
    const config = X402_PAYMENT_SCENARIOS[scenario];

    return {
      status: 402,
      headers: {
        "Content-Type": "application/json",
        "X-Payment-Required": "x402",
        "X-Payment-Amount": paymentRequest.amount,
        "X-Payment-Currency": paymentRequest.currency,
        "X-Payment-Recipient": paymentRequest.recipient,
        "X-Payment-Id": paymentRequest.paymentId,
      },
      body: {
        error: "Payment Required",
        code: 402,
        message: config.description,
        payment: {
          id: paymentRequest.paymentId,
          amount: paymentRequest.amount,
          currency: paymentRequest.currency,
          recipient: paymentRequest.recipient,
          deadline: paymentRequest.deadline,
          description: config.description,
          facilitator: this.facilitatorUrl,
        },
      },
    };
  }

  /**
   * Verify payment with x402 facilitator
   */
  async verifyPayment(
    paymentId: string,
    transactionHash: string,
  ): Promise<X402PaymentVerification> {
    try {
      const pendingPayment = this.pendingPayments.get(paymentId);
      if (!pendingPayment) {
        throw new Error("Payment not found");
      }

      // Call x402 facilitator to verify payment
      const response = await fetch(`${this.facilitatorUrl}/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentId,
          transactionHash,
          expectedAmount: pendingPayment.amount,
          expectedRecipient: pendingPayment.recipient,
          expectedCurrency: pendingPayment.currency,
        }),
      });

      if (!response.ok) {
        throw new Error(`Verification failed: ${response.statusText}`);
      }

      const verificationResult =
        (await response.json()) as X402VerificationResult;

      const verification: X402PaymentVerification = {
        paymentId,
        transactionHash,
        verified: verificationResult.verified || false,
        amount: verificationResult.amount || pendingPayment.amount,
        timestamp: Math.floor(Date.now() / 1000),
      };

      if (verification.verified) {
        // Remove from pending payments
        this.pendingPayments.delete(paymentId);

        console.log("✅ [X402 PAYMENT VERIFIED]", {
          paymentId,
          transactionHash,
          amount: verification.amount,
          timestamp: new Date(verification.timestamp * 1000).toISOString(),
        });

        // Call settle endpoint to complete the payment
        await this.settlePayment(paymentId, transactionHash);
      } else {
        console.log("❌ [X402 PAYMENT FAILED]", {
          paymentId,
          transactionHash,
          reason: verificationResult.reason || "Unknown",
        });
      }

      return verification;
    } catch (error) {
      console.error("❌ [X402 VERIFICATION ERROR]", {
        paymentId,
        transactionHash,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        paymentId,
        transactionHash,
        verified: false,
        amount: "0",
        timestamp: Math.floor(Date.now() / 1000),
      };
    }
  }

  /**
   * Settle payment with x402 facilitator
   */
  private async settlePayment(
    paymentId: string,
    transactionHash: string,
  ): Promise<void> {
    try {
      const response = await fetch(`${this.facilitatorUrl}/settle`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentId,
          transactionHash,
        }),
      });

      if (!response.ok) {
        console.error("❌ [X402 SETTLEMENT FAILED]", {
          paymentId,
          transactionHash,
          status: response.status,
          statusText: response.statusText,
        });
      } else {
        console.log("✅ [X402 PAYMENT SETTLED]", {
          paymentId,
          transactionHash,
        });
      }
    } catch (error) {
      console.error("❌ [X402 SETTLEMENT ERROR]", {
        paymentId,
        transactionHash,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if payment is still pending
   */
  isPaymentPending(paymentId: string): boolean {
    return this.pendingPayments.has(paymentId);
  }

  /**
   * Get pending payment details
   */
  getPendingPayment(paymentId: string): X402PaymentResponse | undefined {
    return this.pendingPayments.get(paymentId);
  }

  /**
   * Clean up expired payments
   */
  cleanupExpiredPayments(): void {
    const now = Math.floor(Date.now() / 1000);
    for (const [paymentId, payment] of this.pendingPayments.entries()) {
      if (payment.deadline < now) {
        this.pendingPayments.delete(paymentId);
        console.log("🧹 [X402 PAYMENT EXPIRED]", {
          paymentId,
          deadline: new Date(payment.deadline * 1000).toISOString(),
        });
      }
    }
  }
}

export default X402PayService;
