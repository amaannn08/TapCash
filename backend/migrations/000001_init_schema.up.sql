-- Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'USER', -- 'USER', 'MERCHANT'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Device Public Keys Table (Ed25519)
CREATE TABLE IF NOT EXISTS device_keys (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    public_key VARCHAR(128) UNIQUE NOT NULL,
    device_name VARCHAR(128) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Wallets Table (Dual Balance: Main Balance + Offline Locked Escrow)
CREATE TABLE IF NOT EXISTS wallets (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency VARCHAR(16) NOT NULL DEFAULT 'INR',
    balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    offline_allocated_cents BIGINT NOT NULL DEFAULT 0 CHECK (offline_allocated_cents >= 0),
    last_sequence_number BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Immutable Double-Entry Ledger Journal Table
CREATE TABLE IF NOT EXISTS ledger_entries (
    id VARCHAR(64) PRIMARY KEY,
    transaction_id VARCHAR(64) NOT NULL,
    wallet_id VARCHAR(64) NOT NULL REFERENCES wallets(id),
    entry_type VARCHAR(16) NOT NULL, -- 'DEBIT', 'CREDIT'
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    balance_after_cents BIGINT NOT NULL CHECK (balance_after_cents >= 0),
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Transactions Table (Online and Settled Offline Transactions)
CREATE TABLE IF NOT EXISTS transactions (
    id VARCHAR(64) PRIMARY KEY,
    idempotency_key VARCHAR(128) UNIQUE,
    payer_wallet_id VARCHAR(64) REFERENCES wallets(id),
    payee_wallet_id VARCHAR(64) REFERENCES wallets(id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(16) NOT NULL DEFAULT 'INR',
    channel VARCHAR(32) NOT NULL, -- 'ONLINE', 'OFFLINE_NFC'
    status VARCHAR(32) NOT NULL, -- 'PENDING', 'PROCESSING', 'SETTLED', 'FAILED'
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Offline Vouchers Table (Reconciliation Tracking)
CREATE TABLE IF NOT EXISTS offline_vouchers (
    voucher_id VARCHAR(64) PRIMARY KEY,
    payer_public_key VARCHAR(128) NOT NULL,
    payer_user_id VARCHAR(64) REFERENCES users(id),
    payee_user_id VARCHAR(64) REFERENCES users(id),
    amount_cents BIGINT NOT NULL,
    sequence_number BIGINT NOT NULL,
    nonce VARCHAR(64) UNIQUE NOT NULL,
    signature VARCHAR(256) NOT NULL,
    timestamp BIGINT NOT NULL,
    reconciliation_status VARCHAR(32) NOT NULL, -- 'RECONCILED', 'DUPLICATE', 'REJECTED'
    reconciled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Idempotency Records Table
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(128) PRIMARY KEY,
    response_code INT NOT NULL,
    response_body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_wallet_id ON ledger_entries(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_tx_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_tx_payer ON transactions(payer_wallet_id);
CREATE INDEX IF NOT EXISTS idx_tx_payee ON transactions(payee_wallet_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_payer_seq ON offline_vouchers(payer_public_key, sequence_number);
