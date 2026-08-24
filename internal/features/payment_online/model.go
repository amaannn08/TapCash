package payment_online

import "time"

type PaymentStatus string

const (
	StatusPending    PaymentStatus = "PENDING"
	StatusProcessing PaymentStatus = "PROCESSING"
	StatusSettled    PaymentStatus = "SETTLED"
	StatusFailed     PaymentStatus = "FAILED"
)

type OnlineTransferRequest struct {
	IdempotencyKey string `json:"idempotency_key"`
	PayeeEmail     string `json:"payee_email"`
	AmountCents    int64  `json:"amount_cents"`
	Description    string `json:"description"`
}

type OnlineTransferResponse struct {
	TransactionID  string        `json:"transaction_id"`
	PayerWalletID  string        `json:"payer_wallet_id"`
	PayeeWalletID  string        `json:"payee_wallet_id"`
	AmountCents    int64         `json:"amount_cents"`
	Currency       string        `json:"currency"`
	Status         PaymentStatus `json:"status"`
	PayerBalance   int64         `json:"payer_balance_cents"`
	CreatedAt      time.Time     `json:"created_at"`
}
