package crypto

import (
	"testing"
	"time"
)

func TestEd25519SigningAndVerification(t *testing.T) {
	kp, err := GenerateEd25519KeyPair()
	if err != nil {
		t.Fatalf("failed to generate keypair: %v", err)
	}

	nonce, err := GenerateNonce()
	if err != nil {
		t.Fatalf("failed to generate nonce: %v", err)
	}

	payload := CanonicalVoucherPayload{
		VoucherID:      "vch_test_123",
		PayerPublicKey: kp.PublicKeyHex,
		PayeeID:        "usr_merchant_456",
		AmountCents:    5000,
		Currency:       "INR",
		SequenceNumber: 1,
		Timestamp:      time.Now().Unix(),
		Nonce:          nonce,
	}

	start := time.Now()
	sig, err := SignPayload(payload, kp.PrivateKeyHex)
	if err != nil {
		t.Fatalf("failed to sign payload: %v", err)
	}
	signElapsed := time.Since(start)

	if signElapsed > 50*time.Millisecond {
		t.Errorf("signing took too long: %v (expected <50ms)", signElapsed)
	}

	// Verify valid signature
	valid, err := VerifySignature(payload, kp.PublicKeyHex, sig)
	if err != nil || !valid {
		t.Fatalf("expected valid signature, got valid=%v, err=%v", valid, err)
	}

	// Tampered amount must fail
	tamperedPayload := payload
	tamperedPayload.AmountCents = 999999
	tamperedValid, _ := VerifySignature(tamperedPayload, kp.PublicKeyHex, sig)
	if tamperedValid {
		t.Fatalf("tampered payload should have failed verification!")
	}

	// Tampered sequence number must fail
	tamperedSeq := payload
	tamperedSeq.SequenceNumber = 2
	tamperedValid, _ = VerifySignature(tamperedSeq, kp.PublicKeyHex, sig)
	if tamperedValid {
		t.Fatalf("tampered sequence number should have failed verification!")
	}
}

func TestNonceRegistryReplayProtection(t *testing.T) {
	reg := NewNonceRegistry(100 * time.Millisecond)
	nonce := "unique-nonce-12345"

	// First registration succeeds
	if err := reg.CheckAndRecord(nonce); err != nil {
		t.Fatalf("first registration should succeed, got %v", err)
	}

	// Duplicate registration must fail with ErrReplayDetected
	if err := reg.CheckAndRecord(nonce); err != ErrReplayDetected {
		t.Fatalf("expected ErrReplayDetected, got %v", err)
	}
}
