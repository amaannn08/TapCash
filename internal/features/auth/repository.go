package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrUserNotFound = errors.New("user not found")

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

func (r *Repository) CreateUserWithWallet(ctx context.Context, u *User, walletID string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	queryUser := `
		INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
	`
	_, err = tx.Exec(ctx, queryUser, u.ID, u.Name, u.Email, u.PasswordHash, u.Role, u.CreatedAt, u.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to insert user: %w", err)
	}

	queryWallet := `
		INSERT INTO wallets (id, user_id, currency, balance_cents, offline_allocated_cents, last_sequence_number)
		VALUES ($1, $2, 'INR', 0, 0, 0)
	`
	_, err = tx.Exec(ctx, queryWallet, walletID, u.ID)
	if err != nil {
		return fmt.Errorf("failed to create default wallet: %w", err)
	}

	return tx.Commit(ctx)
}

func (r *Repository) FindByEmail(ctx context.Context, email string) (*User, error) {
	query := `SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE email = $1`
	var u User
	err := r.pool.QueryRow(ctx, query, email).Scan(&u.ID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to query user by email: %w", err)
	}
	return &u, nil
}

func (r *Repository) FindByID(ctx context.Context, id string) (*User, error) {
	query := `SELECT id, name, email, password_hash, role, created_at, updated_at FROM users WHERE id = $1`
	var u User
	err := r.pool.QueryRow(ctx, query, id).Scan(&u.ID, &u.Name, &u.Email, &u.PasswordHash, &u.Role, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, fmt.Errorf("failed to query user by id: %w", err)
	}
	return &u, nil
}

func (r *Repository) SaveDeviceKey(ctx context.Context, dk *DeviceKey) error {
	query := `
		INSERT INTO device_keys (id, user_id, public_key, device_name, is_active, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (public_key) DO UPDATE SET is_active = EXCLUDED.is_active
	`
	_, err := r.pool.Exec(ctx, query, dk.ID, dk.UserID, dk.PublicKey, dk.DeviceName, dk.IsActive, dk.CreatedAt)
	return err
}

func (r *Repository) FindUserByDeviceKey(ctx context.Context, pubKey string) (string, error) {
	query := `SELECT user_id FROM device_keys WHERE public_key = $1 AND is_active = TRUE`
	var userID string
	err := r.pool.QueryRow(ctx, query, pubKey).Scan(&userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", errors.New("device public key not registered")
		}
		return "", err
	}
	return userID, nil
}
