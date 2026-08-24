import { LocalDB, PendingVoucher } from '../../core/database/sqlite';

export interface TapPaymentRequest {
  payeeId: string;
  payeeName: string;
  amountCents: number;
}

export interface TapPaymentResult {
  success: boolean;
  voucher?: PendingVoucher;
  latencyMs: number;
  error?: string;
}

export class MockTapBridge {
  static async executeNfcExchange(req: TapPaymentRequest): Promise<TapPaymentResult> {
    const startTime = Date.now();

    // 1. Simulate NFC APDU / ISO-DEP handoff latency (150ms - 300ms)
    const simulatedNfcLatency = 180 + Math.floor(Math.random() * 80);
    await new Promise((resolve) => setTimeout(resolve, simulatedNfcLatency));

    // 2. Monotonic sequence counter advance
    const nextSeq = LocalDB.getSequence() + 1;
    const voucherId = `vch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // 3. Mock Ed25519 signature generation
    const mockSig = `ed25519_sig_${Math.random().toString(36).substring(2, 15)}_${Math.random().toString(36).substring(2, 15)}`;

    const voucher: PendingVoucher = {
      voucherId,
      payerPublicKey: 'pub_ed25519_mock_client_device_key_77a9',
      payeeId: req.payeeId,
      amountCents: req.amountCents,
      currency: 'INR',
      sequenceNumber: nextSeq,
      timestamp: Date.now(),
      nonce,
      signature: mockSig,
      status: 'PENDING',
    };

    // 4. Atomic local ledger write
    const ok = LocalDB.recordOfflineDebit(voucher, `NFC Tap to ${req.payeeName}`);
    const totalLatency = Date.now() - startTime;

    if (!ok) {
      return {
        success: false,
        latencyMs: totalLatency,
        error: 'Insufficient offline wallet balance',
      };
    }

    return {
      success: true,
      voucher,
      latencyMs: totalLatency,
    };
  }
}
