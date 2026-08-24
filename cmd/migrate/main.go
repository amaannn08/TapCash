package main

import (
	"context"
	"log"
	"os"

	"github.com/amaannn08/TapCash/internal/pkg/database"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}

	ctx := context.Background()
	pgDB, err := database.NewPostgresConnection(ctx, dbURL)
	if err != nil {
		log.Fatalf("Database connection failed: %v", err)
	}
	defer pgDB.Close()

	if err := database.RunMigrations(ctx, pgDB, "backend/migrations"); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}
	log.Println("Database schema successfully provisioned on Neon DB.")
}
