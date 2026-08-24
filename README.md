# TapCash 💳⚡

> Production-Grade P2P & P2M Offline NFC Payment Platform with Double-Entry Accounting & Conflict-Free Ledger Reconciliation.

[![TapCash CI & Android APK Build](https://github.com/amaannn08/TapCash/actions/workflows/build-apk.yml/badge.svg)](https://github.com/amaannn08/TapCash/actions/workflows/build-apk.yml)

---

## 🌟 Core Engineering Highlights

- **P2P & P2M Transfers (Online & Offline NFC)**: Sub-second online settlements via ACID double-entry journal and instant (<500ms) cryptographically signed offline NFC vouchers.
- **Ed25519 Cryptographic Signatures**: Deterministic canonical payload hashing, replay protection with nonce registries, and monotonic sequence counter validation.
- **PostgreSQL ACID Double-Entry Core**: Zero float precision bugs (integer cents), balance invariants, and `SELECT ... FOR UPDATE` deterministic row locking to prevent deadlocks and race conditions.
- **High-Performance 10,000+ Transaction Simulator**: Benchmark harness capable of generating 10K+ signed offline vouchers and reconciling them across concurrent worker pools with automated **100% Mathematical Balance Conservation** audits:
  $$\sum \text{Initial Balances} = \sum \text{Final Balances}$$
- **Clean React Native / Expo Mobile App**: Local encrypted SQLite ledger, NFC APDU engine, and interactive Mock Tap Bridge emulator.
- **GitHub Actions CI/CD**: Automated testing and Android APK build artifact generation.

---

## 🏗️ Architecture & Project Layout

```
TapCash/
├── cmd/
│   ├── server/           # Chi REST API gateway & handlers
│   ├── simulator/        # 10,000+ Offline Transaction Benchmark Suite
│   └── migrate/          # Database schema provisioner
│
├── internal/
│   ├── features/
│   │   ├── auth/         # User Identity, JWT & Ed25519 Device Key Registry
│   │   ├── wallet/       # Balances, Offline Escrow & Double-Entry Ledger
│   │   ├── payment_online/# Online P2P state machine & Redis idempotency
│   │   └── offline_sync/ # Batch voucher reconciler & deadlock-free worker pool
│   └── pkg/
│       ├── crypto/       # Ed25519 signer, verifier, nonce registry
│       ├── database/     # Neon PostgreSQL connection pool & migrations
│       └── redis/        # Redis distributed lock manager
│
├── mobile/               # Feature-First React Native / Expo TypeScript App
│   ├── src/core/         # SQLite local ledger & theme
│   ├── src/features/     # Tap-to-Pay, Sync Hub & Wallet
│   └── App.tsx           # Wallet Dashboard & NFC Mock Tap Bridge
│
├── .github/workflows/    # GitHub Actions Android APK Builder
└── backend/migrations/   # PostgreSQL SQL DDL migrations
```

---

## 🚀 Quickstart Guide

### 1. Environment Setup
Create a `.env` file in the root directory:
```env
PORT=8080
DATABASE_URL=postgresql://neondb_owner:npg_S6lzYiTAdD8y@ep-sweet-forest-aypjqe2w-pooler.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=super-secret-tapcash-jwt-key
```

### 2. Run Database Migrations
```bash
go run cmd/migrate/main.go
```

### 3. Start Backend Server
```bash
go run cmd/server/main.go
```

### 4. Run the 10,000 Offline Transaction Simulation
```bash
go run cmd/simulator/main.go --users 50 --txs 10000 --concurrency 25
```

### 5. Launch Mobile Client
```bash
cd mobile
npm install
npx expo start
```

---

## 🛡️ Cryptographic NFC Protocol (<500ms)

```
[ Payer Mobile Client ]                             [ Merchant POS Terminal ]
        |                                                       |
        | ----- 1. Request Payment Intent (Amount, PayeeID) --> |
        | <---- 2. Return Terminal Challenge Nonce ------------ |
        |                                                       |
        | (Sign Canonical Payload with Ed25519 Private Key)     |
        | [VoucherID, PubKey, PayeeID, Amount, Seq, Nonce, Sig] |
        |                                                       |
        | ----- 3. Transmit Signed APDU / ISO-DEP Frame ------> |
        |                                                       |
        | (Record Local Debit in SQLite Ledger)                 | (Record Local Credit)
```

---

## 📄 License
MIT License. Built with clean architecture principles.
