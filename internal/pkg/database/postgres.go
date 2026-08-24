package database

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresDB encapsulates pgxpool.Pool connection.
type PostgresDB struct {
	Pool *pgxpool.Pool
}

// NewPostgresConnection initializes a resilient connection pool to PostgreSQL (e.g. Neon DB).
func NewPostgresConnection(ctx context.Context, databaseURL string) (*PostgresDB, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database url: %w", err)
	}

	// Performance & Resilience configuration for high-throughput reconciliation
	config.MaxConns = 25
	config.MinConns = 5
	config.MaxConnLifetime = 30 * time.Minute
	config.MaxConnIdleTime = 5 * time.Minute
	config.HealthCheckPeriod = 1 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("failed to create pgx connection pool: %w", err)
	}

	// Ping database with timeout
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping postgres database: %w", err)
	}

	log.Println("[DB] Successfully connected to PostgreSQL (Neon DB Pool)")
	return &PostgresDB{Pool: pool}, nil
}

// Close gracefully terminates the connection pool.
func (db *PostgresDB) Close() {
	if db.Pool != nil {
		db.Pool.Close()
	}
}
