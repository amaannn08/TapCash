package database

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// RunMigrations executes initial SQL migration scripts on startup.
func RunMigrations(ctx context.Context, db *PostgresDB, migrationsPath string) error {
	entries, err := os.ReadDir(migrationsPath)
	if err != nil {
		return fmt.Errorf("failed to read migrations directory: %w", err)
	}

	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".sql" {
			filePath := filepath.Join(migrationsPath, entry.Name())
			sqlBytes, err := os.ReadFile(filePath)
			if err != nil {
				return fmt.Errorf("failed to read migration file %s: %w", entry.Name(), err)
			}

			log.Printf("[Migration] Applying %s...\n", entry.Name())
			if _, err := db.Pool.Exec(ctx, string(sqlBytes)); err != nil {
				return fmt.Errorf("migration %s failed: %w", entry.Name(), err)
			}
		}
	}

	log.Println("[Migration] All database migrations successfully applied.")
	return nil
}
