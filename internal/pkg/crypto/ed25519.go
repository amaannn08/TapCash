package crypto

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"
)

var (
	ErrInvalidKeyLength = errors.New("invalid key length")
	ErrInvalidSignature = errors.New("invalid cryptographic signature")
	ErrReplayDetected   = errors.New("replay attack detected or duplicate nonce")
)

// KeyPair encapsulates Ed25519 public and private keys.
type KeyPair struct {
	PublicKeyHex  string `json:"public_key"`
	PrivateKeyHex string `json:"private_key,omitempty"`
}

// GenerateEd25519KeyPair generates a fresh Ed25519 keypair and returns hex-encoded keys.
func GenerateEd25519KeyPair() (*KeyPair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed to generate ed25519 key: %w", err)
	}
	return &KeyPair{
		PublicKeyHex:  hex.EncodeToString(pub),
		PrivateKeyHex: hex.EncodeToString(priv),
	}, nil
}

// CanonicalVoucherPayload represents the exact immutable data signed during an NFC exchange (<500ms).
type CanonicalVoucherPayload struct {
	VoucherID      string `json:"voucher_id"`
	PayerPublicKey string `json:"payer_public_key"`
	PayeeID        string `json:"payee_id"`
	AmountCents    int64  `json:"amount_cents"`
	Currency       string `json:"currency"`
	SequenceNumber int64  `json:"sequence_number"`
	Timestamp      int64  `json:"timestamp"`
	Nonce          string `json:"nonce"`
}

// CanonicalBytes serializes the payload deterministically to avoid signature malleability.
func (p CanonicalVoucherPayload) CanonicalBytes() ([]byte, error) {
	// Standard sorted JSON marshaling for deterministic byte representation
	return json.Marshal(p)
}

// SignPayload signs a canonical voucher payload with an Ed25519 private key.
func SignPayload(payload CanonicalVoucherPayload, privKeyHex string) (string, error) {
	privBytes, err := hex.DecodeString(privKeyHex)
	if err != nil {
		return "", fmt.Errorf("invalid private key hex: %w", err)
	}
	if len(privBytes) != ed25519.PrivateKeySize {
		return "", ErrInvalidKeyLength
	}

	data, err := payload.CanonicalBytes()
	if err != nil {
		return "", fmt.Errorf("failed to serialize payload: %w", err)
	}

	sig := ed25519.Sign(privBytes, data)
	return hex.EncodeToString(sig), nil
}

// VerifySignature verifies an Ed25519 signature against the canonical voucher payload and payer public key.
func VerifySignature(payload CanonicalVoucherPayload, pubKeyHex, sigHex string) (bool, error) {
	pubBytes, err := hex.DecodeString(pubKeyHex)
	if err != nil {
		return false, fmt.Errorf("invalid public key hex: %w", err)
	}
	if len(pubBytes) != ed25519.PublicKeySize {
		return false, ErrInvalidKeyLength
	}

	sigBytes, err := hex.DecodeString(sigHex)
	if err != nil {
		return false, fmt.Errorf("invalid signature hex: %w", err)
	}
	if len(sigBytes) != ed25519.SignatureSize {
		return false, ErrInvalidSignature
	}

	data, err := payload.CanonicalBytes()
	if err != nil {
		return false, fmt.Errorf("failed to serialize payload: %w", err)
	}

	if !ed25519.Verify(pubBytes, data, sigBytes) {
		return false, ErrInvalidSignature
	}

	return true, nil
}

// GenerateNonce creates a cryptographically secure random 16-byte hex nonce.
func GenerateNonce() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// SHA256Checksum computes a hex-encoded SHA-256 hash of arbitrary bytes.
func SHA256Checksum(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// NonceRegistry provides in-memory thread-safe replay cache with TTL expiry.
type NonceRegistry struct {
	mu     sync.RWMutex
	nonces map[string]time.Time
	ttl    time.Duration
}

// NewNonceRegistry initializes a registry with a default retention TTL.
func NewNonceRegistry(ttl time.Duration) *NonceRegistry {
	r := &NonceRegistry{
		nonces: make(map[string]time.Time),
		ttl:    ttl,
	}
	go r.startCleanupLoop()
	return r
}

// CheckAndRecord ensures a nonce has not been seen before, and records it.
func (r *NonceRegistry) CheckAndRecord(nonce string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.nonces[nonce]; exists {
		return ErrReplayDetected
	}

	r.nonces[nonce] = time.Now().Add(r.ttl)
	return nil
}

func (r *NonceRegistry) startCleanupLoop() {
	ticker := time.NewTicker(r.ttl)
	for range ticker.C {
		r.mu.Lock()
		now := time.Now()
		for k, exp := range r.nonces {
			if now.After(exp) {
				delete(r.nonces, k)
			}
		}
		r.mu.Unlock()
	}
}
