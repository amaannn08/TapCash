package payment_online

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/amaannn08/TapCash/internal/pkg/redis"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSelfTransfer        = errors.New("cannot transfer funds to your own wallet")
	ErrInsufficientFunds   = errors.New("insufficient available balance")
	ErrPayeeNotFound       = errors.New("recipient user/wallet not found")
	ErrIdempotentDuplicate = errors.New("duplicate request already processed")
)

type Service struct {
	pool        *pgxpool.Pool
	redisClient *redis.Client
}

func NewService(pool *pgxpool.Pool, redisClient *redis.Client) *Service {
	return &Service{
		pool:        pool,
		redisClient: redisClient,
	}
}

// Transfer executes an ACID double-entry online transfer with row locking and Redis idempotency locks.
func (s *Service) Transfer(ctx context.Context, payerUserID string, req OnlineTransferRequest) (*OnlineTransferResponse, error) {
	if req.AmountCents <= 0 {
		return nil, errors.New("amount must be greater than zero")
	}

	// 1. Redis Distributed Lock to guarantee Idempotency
	lockKey := fmt.Sprintf("idempotency:%s", req.IdempotencyKey)
	lockToken, err := s.redisClient.TryAcquireLock(ctx, lockKey, 10*time.Second)
	if err != nil {
		return nil, fmt.Errorf("concurrent transfer in progress: %w", err)
	}
	defer s.redisClient.ReleaseLock(ctx, lockKey, lockToken)

	// 2. Start PostgreSQL ACID transaction
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to start database transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// 3. Resolve Payee
	var payeeUserID, payeeWalletID string
	err = tx.QueryRow(ctx, "SELECT id FROM users WHERE email = $1", req.PayeeEmail).Scan(&payeeUserID)
	if err != nil {
		return nil, ErrPayeeNotFound
	}
	if payeeUserID == payerUserID {
		return nil, ErrSelfTransfer
	}

	err = tx.QueryRow(ctx, "SELECT id FROM wallets WHERE user_id = $1", payeeUserID).Scan(&payeeWalletID)
	if err != nil {
		return nil, ErrPayeeNotFound
	}

	// 4. Resolve Payer Wallet & Lock row
	var payerWalletID, currency string
	var payerBalance, payerAllocated int64
	err = tx.QueryRow(ctx, `
		SELECT id, currency, balance_cents, offline_allocated_cents
		FROM wallets WHERE user_id = $1 FOR UPDATE
	`, payerUserID).Scan(&payerWalletID, &currency, &payerBalance, &payerAllocated)
	if err != nil {
		return nil, errors.New("payer wallet not found")
	}

	available := payerBalance - payerAllocated
	if available < req.AmountCents {
		return nil, ErrInsufficientFunds
	}

	// 5. Lock Payee Wallet row
	var payeeBalance int64
	err = tx.QueryRow(ctx, `
		SELECT balance_cents FROM wallets WHERE id = $1 FOR UPDATE
	`, payeeWalletID).Scan(&payeeBalance)
	if err != nil {
		return nil, errors.New("payee wallet locked or missing")
	}

	// 6. Perform Double-Entry Calculations
	newPayerBalance := payerBalance - req.AmountCents
	newPayeeBalance := payeeBalance + req.AmountCents
	txID := fmt.Sprintf("tx_p2p_%s", uuid.New().String())

	// Update Payer Wallet
	_, err = tx.Exec(ctx, "UPDATE wallets SET balance_cents = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", newPayerBalance, payerWalletID)
	if err != nil {
		return nil, err
	}

	// Update Payee Wallet
	_, err = tx.Exec(ctx, "UPDATE wallets SET balance_cents = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2", newPayeeBalance, payeeWalletID)
	if err != nil {
		return nil, err
	}

	// 7. Write Double-Entry Ledger Entries (1 Debit + 1 Credit)
	debitLedgerID := fmt.Sprintf("led_dr_%s", uuid.New().String())
	creditLedgerID := fmt.Sprintf("led_cr_%s", uuid.New().String())

	descDebit := fmt.Sprintf("Sent to %s: %s", req.PayeeEmail, req.Description)
	descCredit := fmt.Sprintf("Received from P2P transfer: %s", req.Description)

	_, err = tx.Exec(ctx, `
		INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, description, created_at)
		VALUES ($1, $2, $3, 'DEBIT', $4, $5, $6, CURRENT_TIMESTAMP)
	`, debitLedgerID, txID, payerWalletID, req.AmountCents, newPayerBalance, descDebit)
	if err != nil {
		return nil, err
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, description, created_at)
		VALUES ($1, $2, $3, 'CREDIT', $4, $5, $6, CURRENT_TIMESTAMP)
	`, creditLedgerID, txID, payeeWalletID, req.AmountCents, newPayeeBalance, descCredit)
	if err != nil {
		return nil, err
	}

	// 8. Record Main Transaction (State: SETTLED)
	_, err = tx.Exec(ctx, `
		INSERT INTO transactions (id, idempotency_key, payer_wallet_id, payee_wallet_id, amount_cents, currency, channel, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'ONLINE', 'SETTLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`, txID, req.IdempotencyKey, payerWalletID, payeeWalletID, req.AmountCents, currency)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit online payment tx: %w", err)
	}

	return &OnlineTransferResponse{
		TransactionID: txID,
		PayerWalletID: payerWalletID,
		PayeeWalletID: payeeWalletID,
		AmountCents:   req.AmountCents,
		Currency:      currency,
		Status:        StatusSettled,
		PayerBalance:  newPayerBalance,
		CreatedAt:     time.Now(),
	}, nil
}
