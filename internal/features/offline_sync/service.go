package offline_sync

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/amaannn08/TapCash/internal/pkg/crypto"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool          *pgxpool.Pool
	nonceRegistry *crypto.NonceRegistry
}

func NewService(pool *pgxpool.Pool) *Service {
	return &Service{
		pool:          pool,
		nonceRegistry: crypto.NewNonceRegistry(24 * time.Hour),
	}
}

// ReconcileBatch processes a batch of offline NFC vouchers with parallel signature verification and atomic double-entry ledger writes.
func (s *Service) ReconcileBatch(ctx context.Context, req SyncBatchRequest) (*SyncBatchResponse, error) {
	start := time.Now()
	total := len(req.Vouchers)
	results := make([]VoucherSyncResult, total)

	if total == 0 {
		return &SyncBatchResponse{
			BatchID:         req.BatchID,
			TotalVouchers:   0,
			ExecutionTimeMs: 0,
			Results:         []VoucherSyncResult{},
		}, nil
	}

	// 1. Parallel Ed25519 Cryptographic Signature Verification
	type sigValidationResult struct {
		index int
		valid bool
		err   error
	}

	sigChan := make(chan sigValidationResult, total)
	var wg sync.WaitGroup

	for i, v := range req.Vouchers {
		wg.Add(1)
		go func(idx int, voucher OfflineVoucher) {
			defer wg.Done()
			payload := crypto.CanonicalVoucherPayload{
				VoucherID:      voucher.VoucherID,
				PayerPublicKey: voucher.PayerPublicKey,
				PayeeID:        voucher.PayeeID,
				AmountCents:    voucher.AmountCents,
				Currency:       voucher.Currency,
				SequenceNumber: voucher.SequenceNumber,
				Timestamp:      voucher.Timestamp,
				Nonce:          voucher.Nonce,
			}
			valid, err := crypto.VerifySignature(payload, voucher.PayerPublicKey, voucher.Signature)
			sigChan <- sigValidationResult{index: idx, valid: valid, err: err}
		}(i, v)
	}

	wg.Wait()
	close(sigChan)

	validMap := make(map[int]bool)
	for res := range sigChan {
		if !res.valid || res.err != nil {
			results[res.index] = VoucherSyncResult{
				VoucherID: req.Vouchers[res.index].VoucherID,
				Status:    StatusRejected,
				Reason:    "cryptographic signature verification failed",
			}
		} else {
			validMap[res.index] = true
		}
	}

	// 2. Sort valid vouchers by SequenceNumber to guarantee monotonic ledger application
	type indexedVoucher struct {
		index   int
		voucher OfflineVoucher
	}

	var validVouchers []indexedVoucher
	for idx := range validMap {
		validVouchers = append(validVouchers, indexedVoucher{index: idx, voucher: req.Vouchers[idx]})
	}

	sort.Slice(validVouchers, func(i, j int) bool {
		return validVouchers[i].voucher.SequenceNumber < validVouchers[j].voucher.SequenceNumber
	})

	// 3. Process Ledger Reconciliation per voucher with Row-Locking and Invariant Validation
	var reconciledCount, duplicateCount, rejectedCount int

	for _, item := range validVouchers {
		v := item.voucher
		idx := item.index

		status, reason := s.processSingleVoucher(ctx, v)
		results[idx] = VoucherSyncResult{
			VoucherID: v.VoucherID,
			Status:    status,
			Reason:    reason,
		}

		switch status {
		case StatusReconciled:
			reconciledCount++
		case StatusDuplicate:
			duplicateCount++
		case StatusRejected:
			rejectedCount++
		}
	}

	for _, r := range results {
		if r.Status == StatusRejected && r.Reason == "cryptographic signature verification failed" {
			rejectedCount++
		}
	}

	elapsed := time.Since(start).Milliseconds()

	return &SyncBatchResponse{
		BatchID:         req.BatchID,
		TotalVouchers:   total,
		ReconciledCount: reconciledCount,
		DuplicateCount:  duplicateCount,
		RejectedCount:   rejectedCount,
		ExecutionTimeMs: elapsed,
		Results:         results,
	}, nil
}

func (s *Service) processSingleVoucher(ctx context.Context, v OfflineVoucher) (VoucherReconcileStatus, string) {
	// Replay Protection Check
	if err := s.nonceRegistry.CheckAndRecord(v.Nonce); err != nil {
		return StatusDuplicate, "duplicate nonce / voucher already processed"
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return StatusRejected, fmt.Sprintf("database transaction error: %v", err)
	}
	defer tx.Rollback(ctx)

	// Check DB if voucher already recorded
	var existingID string
	err = tx.QueryRow(ctx, "SELECT voucher_id FROM offline_vouchers WHERE voucher_id = $1 OR nonce = $2", v.VoucherID, v.Nonce).Scan(&existingID)
	if err == nil {
		return StatusDuplicate, "voucher previously reconciled"
	}

	// 1. Resolve Payer by Device Key
	var payerUserID string
	err = tx.QueryRow(ctx, "SELECT user_id FROM device_keys WHERE public_key = $1 AND is_active = TRUE", v.PayerPublicKey).Scan(&payerUserID)
	if err != nil {
		return StatusRejected, "payer device public key not registered"
	}

	// 2. Lock Payer Wallet
	var payerWalletID string
	var payerBalance, payerAllocated, lastSeq int64
	err = tx.QueryRow(ctx, `
		SELECT id, balance_cents, offline_allocated_cents, last_sequence_number
		FROM wallets WHERE user_id = $1 FOR UPDATE
	`, payerUserID).Scan(&payerWalletID, &payerBalance, &payerAllocated, &lastSeq)
	if err != nil {
		return StatusRejected, "payer wallet not found"
	}

	// Monotonic Sequence Check
	if v.SequenceNumber <= lastSeq {
		return StatusDuplicate, fmt.Sprintf("sequence counter %d already settled (last: %d)", v.SequenceNumber, lastSeq)
	}

	// Balance Check: Must not exceed total balance (and released from allocated offline escrow)
	if payerBalance < v.AmountCents {
		return StatusRejected, "insufficient funds to reconcile offline voucher"
	}

	// 3. Resolve & Lock Payee Wallet
	var payeeWalletID string
	var payeeBalance int64
	err = tx.QueryRow(ctx, `
		SELECT id, balance_cents FROM wallets WHERE user_id = $1 FOR UPDATE
	`, v.PayeeID).Scan(&payeeWalletID, &payeeBalance)
	if err != nil {
		return StatusRejected, "payee wallet not found"
	}

	// 4. Double-Entry Balance Calculation
	newPayerBalance := payerBalance - v.AmountCents
	newPayerAllocated := payerAllocated - v.AmountCents
	if newPayerAllocated < 0 {
		newPayerAllocated = 0
	}
	newPayeeBalance := payeeBalance + v.AmountCents
	txID := fmt.Sprintf("tx_nfc_%s", uuid.New().String())

	// Update Payer Wallet with monotonic sequence advance
	_, err = tx.Exec(ctx, `
		UPDATE wallets 
		SET balance_cents = $1, offline_allocated_cents = $2, last_sequence_number = $3, updated_at = CURRENT_TIMESTAMP
		WHERE id = $4
	`, newPayerBalance, newPayerAllocated, v.SequenceNumber, payerWalletID)
	if err != nil {
		return StatusRejected, err.Error()
	}

	// Update Payee Wallet
	_, err = tx.Exec(ctx, `
		UPDATE wallets SET balance_cents = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
	`, newPayeeBalance, payeeWalletID)
	if err != nil {
		return StatusRejected, err.Error()
	}

	// 5. Double-Entry Immutable Journal Postings
	debitLedgerID := fmt.Sprintf("led_dr_%s", uuid.New().String())
	creditLedgerID := fmt.Sprintf("led_cr_%s", uuid.New().String())

	descDebit := fmt.Sprintf("Offline NFC Payment to %s (Seq: %d)", v.PayeeID, v.SequenceNumber)
	descCredit := fmt.Sprintf("Offline NFC Voucher Received (Seq: %d)", v.SequenceNumber)

	_, err = tx.Exec(ctx, `
		INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, description, created_at)
		VALUES ($1, $2, $3, 'DEBIT', $4, $5, $6, CURRENT_TIMESTAMP)
	`, debitLedgerID, txID, payerWalletID, v.AmountCents, newPayerBalance, descDebit)
	if err != nil {
		return StatusRejected, err.Error()
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, description, created_at)
		VALUES ($1, $2, $3, 'CREDIT', $4, $5, $6, CURRENT_TIMESTAMP)
	`, creditLedgerID, txID, payeeWalletID, v.AmountCents, newPayeeBalance, descCredit)
	if err != nil {
		return StatusRejected, err.Error()
	}

	// 6. Record Settled Transaction
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, payer_wallet_id, payee_wallet_id, amount_cents, currency, channel, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'OFFLINE_NFC', 'SETTLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, txID, payerWalletID, payeeWalletID, v.AmountCents, v.Currency)
	if err != nil {
		return StatusRejected, err.Error()
	}

	// 7. Record Offline Voucher Entry
	_, err = tx.Exec(ctx, `
		INSERT INTO offline_vouchers (voucher_id, payer_public_key, payer_user_id, payee_user_id, amount_cents, sequence_number, nonce, signature, timestamp, reconciliation_status, reconciled_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'RECONCILED', CURRENT_TIMESTAMP)
	`, v.VoucherID, v.PayerPublicKey, payerUserID, v.PayeeID, v.AmountCents, v.SequenceNumber, v.Nonce, v.Signature, v.Timestamp)
	if err != nil {
		return StatusRejected, err.Error()
	}

	if err := tx.Commit(ctx); err != nil {
		return StatusRejected, fmt.Sprintf("commit failed: %v", err)
	}

	return StatusReconciled, ""
}
