package wallet

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrWalletNotFound      = errors.New("wallet not found")
	ErrInsufficientBalance = errors.New("insufficient balance for transaction")
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) GetByUserID(ctx context.Context, userID string) (*Wallet, error) {
	query := `
		SELECT id, user_id, currency, balance_cents, offline_allocated_cents, last_sequence_number, created_at, updated_at
		FROM wallets WHERE user_id = $1
	`
	var w Wallet
	err := r.pool.QueryRow(ctx, query, userID).Scan(
		&w.ID, &w.UserID, &w.Currency, &w.BalanceCents, &w.OfflineAllocatedCents, &w.LastSequenceNumber, &w.CreatedAt, &w.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWalletNotFound
		}
		return nil, fmt.Errorf("failed to fetch wallet: %w", err)
	}
	w.AvailableBalanceCents = w.BalanceCents - w.OfflineAllocatedCents
	return &w, nil
}

func (r *Repository) GetByID(ctx context.Context, walletID string) (*Wallet, error) {
	query := `
		SELECT id, user_id, currency, balance_cents, offline_allocated_cents, last_sequence_number, created_at, updated_at
		FROM wallets WHERE id = $1
	`
	var w Wallet
	err := r.pool.QueryRow(ctx, query, walletID).Scan(
		&w.ID, &w.UserID, &w.Currency, &w.BalanceCents, &w.OfflineAllocatedCents, &w.LastSequenceNumber, &w.CreatedAt, &w.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrWalletNotFound
		}
		return nil, fmt.Errorf("failed to fetch wallet: %w", err)
	}
	w.AvailableBalanceCents = w.BalanceCents - w.OfflineAllocatedCents
	return &w, nil
}

// FundWallet credits money into a wallet and records an immutable double-entry ledger journal.
func (r *Repository) FundWallet(ctx context.Context, walletID string, amountCents int64, description string) (*Wallet, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to start tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// SELECT FOR UPDATE row lock to serialize ledger operations
	var currentBalance, offlineAllocated, lastSeq int64
	var userID, currency string
	var createdAt, updatedAt time.Time

	lockQuery := `
		SELECT user_id, currency, balance_cents, offline_allocated_cents, last_sequence_number, created_at, updated_at
		FROM wallets WHERE id = $1 FOR UPDATE
	`
	err = tx.QueryRow(ctx, lockQuery, walletID).Scan(
		&userID, &currency, &currentBalance, &offlineAllocated, &lastSeq, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, ErrWalletNotFound
	}

	newBalance := currentBalance + amountCents
	txID := fmt.Sprintf("tx_fund_%s", uuid.New().String())
	ledgerEntryID := fmt.Sprintf("led_%s", uuid.New().String())

	// Update Wallet balance
	updateQuery := `UPDATE wallets SET balance_cents = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
	if _, err := tx.Exec(ctx, updateQuery, newBalance, walletID); err != nil {
		return nil, fmt.Errorf("failed to update wallet balance: %w", err)
	}

	// Insert immutable Ledger Entry
	ledgerQuery := `
		INSERT INTO ledger_entries (id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, description, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
	`
	if _, err := tx.Exec(ctx, ledgerQuery, ledgerEntryID, txID, walletID, EntryCredit, amountCents, newBalance, description); err != nil {
		return nil, fmt.Errorf("failed to insert ledger entry: %w", err)
	}

	// Insert Transaction Record
	txQuery := `
		INSERT INTO transactions (id, payee_wallet_id, amount_cents, currency, channel, status, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'ONLINE', 'SETTLED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	`
	if _, err := tx.Exec(ctx, txQuery, txID, walletID, amountCents, currency); err != nil {
		return nil, fmt.Errorf("failed to insert transaction: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit fund tx: %w", err)
	}

	return &Wallet{
		ID:                    walletID,
		UserID:                userID,
		Currency:              currency,
		BalanceCents:          newBalance,
		OfflineAllocatedCents: offlineAllocated,
		AvailableBalanceCents: newBalance - offlineAllocated,
		LastSequenceNumber:    lastSeq,
		CreatedAt:             createdAt,
		UpdatedAt:             time.Now(),
	}, nil
}

// AllocateOffline locks funds into offline escrow to prevent double spending when disconnected.
func (r *Repository) AllocateOffline(ctx context.Context, walletID string, amountCents int64) (*Wallet, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var balance, allocated, lastSeq int64
	var userID, currency string
	var createdAt, updatedAt time.Time

	lockQuery := `
		SELECT user_id, currency, balance_cents, offline_allocated_cents, last_sequence_number, created_at, updated_at
		FROM wallets WHERE id = $1 FOR UPDATE
	`
	if err := tx.QueryRow(ctx, lockQuery, walletID).Scan(&userID, &currency, &balance, &allocated, &lastSeq, &createdAt, &updatedAt); err != nil {
		return nil, ErrWalletNotFound
	}

	available := balance - allocated
	if available < amountCents {
		return nil, ErrInsufficientBalance
	}

	newAllocated := allocated + amountCents
	updateQuery := `UPDATE wallets SET offline_allocated_cents = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
	if _, err := tx.Exec(ctx, updateQuery, newAllocated, walletID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &Wallet{
		ID:                    walletID,
		UserID:                userID,
		Currency:              currency,
		BalanceCents:          balance,
		OfflineAllocatedCents: newAllocated,
		AvailableBalanceCents: balance - newAllocated,
		LastSequenceNumber:    lastSeq,
		CreatedAt:             createdAt,
		UpdatedAt:             time.Now(),
	}, nil
}

// GetLedgerHistory returns recent ledger statements for a wallet.
func (r *Repository) GetLedgerHistory(ctx context.Context, walletID string, limit int) ([]LedgerEntry, error) {
	query := `
		SELECT id, transaction_id, wallet_id, entry_type, amount_cents, balance_after_cents, description, created_at
		FROM ledger_entries WHERE wallet_id = $1 ORDER BY created_at DESC LIMIT $2
	`
	rows, err := r.pool.Query(ctx, query, walletID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.ID, &e.TransactionID, &e.WalletID, &e.EntryType, &e.AmountCents, &e.BalanceAfterCents, &e.Description, &e.CreatedAt); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, nil
}
