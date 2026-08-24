package offline_sync


type OfflineVoucher struct {
	VoucherID      string `json:"voucher_id"`
	PayerPublicKey string `json:"payer_public_key"`
	PayeeID        string `json:"payee_id"`
	AmountCents    int64  `json:"amount_cents"`
	Currency       string `json:"currency"`
	SequenceNumber int64  `json:"sequence_number"`
	Timestamp      int64  `json:"timestamp"`
	Nonce          string `json:"nonce"`
	Signature      string `json:"signature"`
}

type SyncBatchRequest struct {
	BatchID  string           `json:"batch_id"`
	Vouchers []OfflineVoucher `json:"vouchers"`
}

type VoucherReconcileStatus string

const (
	StatusReconciled VoucherReconcileStatus = "RECONCILED"
	StatusDuplicate  VoucherReconcileStatus = "DUPLICATE"
	StatusRejected   VoucherReconcileStatus = "REJECTED"
)

type VoucherSyncResult struct {
	VoucherID string                 `json:"voucher_id"`
	Status    VoucherReconcileStatus `json:"status"`
	Reason    string                 `json:"reason,omitempty"`
}

type SyncBatchResponse struct {
	BatchID            string              `json:"batch_id"`
	TotalVouchers      int                 `json:"total_vouchers"`
	ReconciledCount    int                 `json:"reconciled_count"`
	DuplicateCount     int                 `json:"duplicate_count"`
	RejectedCount      int                 `json:"rejected_count"`
	ExecutionTimeMs    int64               `json:"execution_time_ms"`
	Results            []VoucherSyncResult `json:"results"`
}
