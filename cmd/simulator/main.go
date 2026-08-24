package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"github.com/amaannn08/TapCash/internal/features/offline_sync"
	"github.com/amaannn08/TapCash/internal/pkg/crypto"
	"github.com/amaannn08/TapCash/internal/pkg/database"
	"github.com/google/uuid"
	"github.com/joho/godotenv"
)

type SimulatedUser struct {
	ID        string
	Name      string
	Email     string
	WalletID  string
	KeyPair   *crypto.KeyPair
	InitialBal int64
	CurrentSeq int64
}

func main() {
	_ = godotenv.Load()

	numUsers := flag.Int("users", 50, "Number of simulated users/merchants")
	numTxs := flag.Int("txs", 10000, "Number of offline transactions to generate & reconcile")
	concurrency := flag.Int("concurrency", 50, "Worker pool concurrency")
	flag.Parse()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	ctx := context.Background()
	pgDB, err := database.NewPostgresConnection(ctx, dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to Neon DB: %v", err)
	}
	defer pgDB.Close()

	log.Println("================================================================")
	log.Printf("🚀 STARTING TAPCASH 10,000+ OFFLINE TRANSACTION SIMULATION SUITE\n")
	log.Printf("👥 Users: %d | ⚡ Transactions: %d | 🔄 Concurrency: %d\n", *numUsers, *numTxs, *concurrency)
	log.Println("================================================================")

	// Step 1: Bootstrap Users, KeyPairs, Wallets & Initial Balances
	log.Println("[1/4] Bootstrapping simulated accounts with cryptographic keypairs...")
	users := make([]*SimulatedUser, *numUsers)
	var expectedTotalSystemBalance int64 = 0

	for i := 0; i < *numUsers; i++ {
		kp, err := crypto.GenerateEd25519KeyPair()
		if err != nil {
			log.Fatalf("Key generation failed: %v", err)
		}

		uID := fmt.Sprintf("sim_usr_%s", uuid.New().String()[:8])
		wID := fmt.Sprintf("sim_wal_%s", uuid.New().String()[:8])
		initialBal := int64(100000) // ₹1,000.00 initial balance in cents
		expectedTotalSystemBalance += initialBal

		user := &SimulatedUser{
			ID:         uID,
			Name:       fmt.Sprintf("User %d", i+1),
			Email:      fmt.Sprintf("sim_user_%d_%s@tapcash.io", i+1, uuid.New().String()[:4]),
			WalletID:   wID,
			KeyPair:    kp,
			InitialBal: initialBal,
			CurrentSeq: 0,
		}

		// Insert user & device key & funded wallet directly
		_, err = pgDB.Pool.Exec(ctx, `
			INSERT INTO users (id, name, email, password_hash, role)
			VALUES ($1, $2, $3, 'hash', 'USER')
			ON CONFLICT (id) DO NOTHING
		`, user.ID, user.Name, user.Email)
		if err != nil {
			log.Fatalf("Failed to create simulated user: %v", err)
		}

		_, err = pgDB.Pool.Exec(ctx, `
			INSERT INTO device_keys (id, user_id, public_key, device_name, is_active)
			VALUES ($1, $2, $3, 'Simulated Phone', TRUE)
			ON CONFLICT (public_key) DO NOTHING
		`, fmt.Sprintf("dk_%s", uuid.New().String()[:8]), user.ID, user.KeyPair.PublicKeyHex)
		if err != nil {
			log.Fatalf("Failed to register device key: %v", err)
		}

		_, err = pgDB.Pool.Exec(ctx, `
			INSERT INTO wallets (id, user_id, currency, balance_cents, offline_allocated_cents, last_sequence_number)
			VALUES ($1, $2, 'INR', $3, 0, 0)
			ON CONFLICT (id) DO NOTHING
		`, user.WalletID, user.ID, user.InitialBal)
		if err != nil {
			log.Fatalf("Failed to create funded wallet: %v", err)
		}

		users[i] = user
	}
	log.Printf("✅ Initialized %d accounts. Total System Balance: ₹%.2f\n", *numUsers, float64(expectedTotalSystemBalance)/100.0)

	// Step 2: Generate 10,000 Cryptographically Signed Offline NFC Vouchers
	log.Println("[2/4] Generating cryptographically signed Ed25519 vouchers (<500ms NFC simulation)...")
	vouchers := make([]offline_sync.OfflineVoucher, *numTxs)
	r := rand.New(rand.NewSource(time.Now().UnixNano()))

	startGen := time.Now()
	for i := 0; i < *numTxs; i++ {
		payerIdx := r.Intn(*numUsers)
		payeeIdx := r.Intn(*numUsers)
		for payeeIdx == payerIdx {
			payeeIdx = r.Intn(*numUsers)
		}

		payer := users[payerIdx]
		payee := users[payeeIdx]

		payer.CurrentSeq++
		seq := payer.CurrentSeq
		amount := int64(r.Intn(50) + 1) // ₹0.01 - ₹0.50 micropayments to preserve solvency

		nonce, _ := crypto.GenerateNonce()
		vID := fmt.Sprintf("vch_sim_%s", uuid.New().String()[:12])
		timestamp := time.Now().Unix()

		payload := crypto.CanonicalVoucherPayload{
			VoucherID:      vID,
			PayerPublicKey: payer.KeyPair.PublicKeyHex,
			PayeeID:        payee.ID,
			AmountCents:    amount,
			Currency:       "INR",
			SequenceNumber: seq,
			Timestamp:      timestamp,
			Nonce:          nonce,
		}

		sig, err := crypto.SignPayload(payload, payer.KeyPair.PrivateKeyHex)
		if err != nil {
			log.Fatalf("Signature generation failed: %v", err)
		}

		vouchers[i] = offline_sync.OfflineVoucher{
			VoucherID:      vID,
			PayerPublicKey: payer.KeyPair.PublicKeyHex,
			PayeeID:        payee.ID,
			AmountCents:    amount,
			Currency:       "INR",
			SequenceNumber: seq,
			Timestamp:      timestamp,
			Nonce:          nonce,
			Signature:      sig,
		}
	}
	genDuration := time.Since(startGen)
	log.Printf("✅ Generated and signed %d vouchers in %v (avg %.2f µs/sig)\n", *numTxs, genDuration, float64(genDuration.Microseconds())/float64(*numTxs))

	// Step 3: Concurrently Dispatch Batches to the Offline Reconciliation Worker Pool
	log.Printf("[3/4] Reconciling %d transactions across %d concurrent workers...\n", *numTxs, *concurrency)
	syncService := offline_sync.NewService(pgDB.Pool)

	batchSize := 100
	var totalBatches = (*numTxs + batchSize - 1) / batchSize
	batchChan := make(chan offline_sync.SyncBatchRequest, totalBatches)

	for i := 0; i < *numTxs; i += batchSize {
		end := i + batchSize
		if end > *numTxs {
			end = *numTxs
		}
		batchChan <- offline_sync.SyncBatchRequest{
			BatchID:  fmt.Sprintf("batch_%d", i/batchSize),
			Vouchers: vouchers[i:end],
		}
	}
	close(batchChan)

	var totalReconciled int64 = 0
	var totalDuplicates int64 = 0
	var totalRejected int64 = 0
	var wg sync.WaitGroup

	startReconcile := time.Now()

	for w := 0; w < *concurrency; w++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for b := range batchChan {
				res, err := syncService.ReconcileBatch(ctx, b)
				if err != nil {
					log.Printf("Worker %d batch error: %v\n", workerID, err)
					continue
				}
				atomic.AddInt64(&totalReconciled, int64(res.ReconciledCount))
				atomic.AddInt64(&totalDuplicates, int64(res.DuplicateCount))
				atomic.AddInt64(&totalRejected, int64(res.RejectedCount))
			}
		}(w)
	}

	wg.Wait()
	reconcileDuration := time.Since(startReconcile)
	tps := float64(totalReconciled) / reconcileDuration.Seconds()

	log.Printf("✅ Batch Reconciliation Complete in %v! TPS: %.2f tx/sec\n", reconcileDuration, tps)
	log.Printf("📊 Stats: Reconciled=%d | Duplicates=%d | Rejected=%d\n", totalReconciled, totalDuplicates, totalRejected)

	// Step 4: Mathematical Balance Conservation Audit
	log.Println("[4/4] Performing ACID Double-Entry Mathematical Conservation Audit...")
	var finalTotalSystemBalance int64 = 0

	for _, u := range users {
		var bal int64
		err := pgDB.Pool.QueryRow(ctx, "SELECT balance_cents FROM wallets WHERE id = $1", u.WalletID).Scan(&bal)
		if err != nil {
			log.Fatalf("Failed to query wallet: %v", err)
		}
		finalTotalSystemBalance += bal
	}

	log.Println("----------------------------------------------------------------")
	log.Printf("💰 Initial Total Balance : ₹%.2f (%d cents)\n", float64(expectedTotalSystemBalance)/100.0, expectedTotalSystemBalance)
	log.Printf("💰 Final Total Balance   : ₹%.2f (%d cents)\n", float64(finalTotalSystemBalance)/100.0, finalTotalSystemBalance)

	if expectedTotalSystemBalance == finalTotalSystemBalance {
		log.Println("🎉 CONSERVATION ASSERTION PASSED: sum(Initial) == sum(Final) [100% INVARIANT PRESERVED]")
	} else {
		log.Fatalf("❌ CRITICAL ERROR: BALANCE DRIFT DETECTED! Delta: %d cents\n", finalTotalSystemBalance-expectedTotalSystemBalance)
	}
	log.Println("================================================================")
}
