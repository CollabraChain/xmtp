import * as fs from "fs";
import type { SmartWalletState, WalletStorageProvider } from "./types";

/**
 * A file-based implementation of the WalletStorageProvider interface
 */
export class FileStorageProvider implements WalletStorageProvider {
  private storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    this.ensureStorageDirectoryExists();
  }

  /**
   * Ensure storage directory exists
   */
  private ensureStorageDirectoryExists(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  /**
   * Get wallet data from storage
   *
   * @param userId - Unique identifier for the user
   * @returns The wallet state or null if not found
   */
  async getWalletData(userId: string): Promise<SmartWalletState | null> {
    const localFilePath = `${this.storageDir}/${userId}.json`;
    try {
      if (fs.existsSync(localFilePath)) {
        const data = fs.readFileSync(localFilePath, "utf8");
        return JSON.parse(data) as SmartWalletState;
      }
    } catch (error) {
      console.warn(`Could not read wallet data from file: ${error as string}`);
    }
    return null;
  }

  /**
   * Save wallet data to storage
   *
   * @param userId - Unique identifier for the user
   * @param data - Wallet state to save
   */
  async saveWalletData(userId: string, data: SmartWalletState): Promise<void> {
    const localFilePath = `${this.storageDir}/${userId}.json`;
    try {
      fs.writeFileSync(localFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error(`Failed to save wallet data: ${error as string}`);
      throw new Error(`Failed to save wallet data: ${error as string}`);
    }
  }
}
