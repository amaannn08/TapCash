// Local Double-Entry Ledger and Offline Sync Queue SQLite abstraction
export interface LocalLedgerEntry {
  id: string;
  voucherId: string;
  type: 'DEBIT' | 'CREDIT';
  amountCents: number;
  balanceAfterCents: number;
  description: string;
  timestamp: number;
}

export interface PendingVoucher {
  voucherId: string;
  payerPublicKey: string;
  payeeId: string;
  amountCents: number;
  currency: string;
  sequenceNumber: number;
  timestamp: number;
  nonce: string;
  signature: string;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
}

class LocalDatabaseManager {
  private localBalanceCents: number = 500000; // ₹5,000.00 mock initial balance
  private currentSequence: number = 0;
  private entries: LocalLedgerEntry[] = [];
  private pendingQueue: PendingVoucher[] = [];

  constructor() {
    this.entries.push({
      id: 'led_init_1',
      voucherId: 'init',
      type: 'CREDIT',
      amountCents: 500000,
      balanceAfterCents: 500000,
      description: 'Initial Wallet Balance',
      timestamp: Date.now() - 86400000,
    });
  }

  getBalance(): number {
    return this.localBalanceCents;
  }

  getSequence(): number {
    return this.currentSequence;
  }

  recordOfflineDebit(voucher: PendingVoucher, description: string): boolean {
    if (this.localBalanceCents < voucher.amountCents) {
      return false;
    }

    this.localBalanceCents -= voucher.amountCents;
    this.currentSequence = voucher.sequenceNumber;

    this.entries.unshift({
      id: `led_local_${Date.now()}`,
      voucherId: voucher.voucherId,
      type: 'DEBIT',
      amountCents: voucher.amountCents,
      balanceAfterCents: this.localBalanceCents,
      description,
      timestamp: voucher.timestamp,
    });

    this.pendingQueue.push(voucher);
    return true;
  }

  recordOfflineCredit(voucher: PendingVoucher, description: string): void {
    this.localBalanceCents += voucher.amountCents;
    this.entries.unshift({
      id: `led_local_${Date.now()}`,
      voucherId: voucher.voucherId,
      type: 'CREDIT',
      amountCents: voucher.amountCents,
      balanceAfterCents: this.localBalanceCents,
      description,
      timestamp: voucher.timestamp,
    });

    this.pendingQueue.push(voucher);
  }

  getHistory(): LocalLedgerEntry[] {
    return [...this.entries];
  }

  getPendingQueue(): PendingVoucher[] {
    return [...this.pendingQueue];
  }

  clearSyncedVouchers(voucherIds: string[]): void {
    const idSet = new Set(voucherIds);
    this.pendingQueue = this.pendingQueue.filter(v => !idSet.has(v.voucherId));
  }
}

export const LocalDB = new LocalDatabaseManager();
