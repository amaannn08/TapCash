package wallet

import "time"

type Wallet struct {
	ID                    string    `json:"id"`
	UserID                string    `json:"user_id"`
	Currency              string    `json:"currency"`
	BalanceCents          int64     `json:"balance_cents"`
	OfflineAllocatedCents int64     `json:"offline_allocated_cents"`
	AvailableBalanceCents int64     `json:"available_balance_cents"`
	LastSequenceNumber    int64     `json:"last_sequence_number"`
	CreatedAt             time.Time `json:"created_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type EntryType string

const (
	EntryDebit  EntryType = "DEBIT"
	EntryCredit EntryType = "CREDIT"
)

type LedgerEntry struct {
	ID                string    `json:"id"`
	TransactionID     string    `json:"transaction_id"`
	WalletID          string    `json:"wallet_id"`
	EntryType         EntryType `json:"entry_type"`
	AmountCents       int64     `json:"amount_cents"`
	BalanceAfterCents int64     `json:"balance_after_cents"`
	Description       string    `json:"description"`
	CreatedAt         time.Time `json:"created_at"`
}

type FundWalletRequest struct {
	AmountCents int64  `json:"amount_cents"`
	Description string `json:"description"`
}

type AllocateOfflineRequest struct {
	AmountCents int64 `json:"amount_cents"`
}
