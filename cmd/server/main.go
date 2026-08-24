package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/amaannn08/TapCash/internal/features/auth"
	"github.com/amaannn08/TapCash/internal/features/offline_sync"
	"github.com/amaannn08/TapCash/internal/features/payment_online"
	"github.com/amaannn08/TapCash/internal/features/wallet"
	"github.com/amaannn08/TapCash/internal/pkg/database"
	"github.com/amaannn08/TapCash/internal/pkg/redis"
	"github.com/amaannn08/TapCash/internal/pkg/response"
	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL environment variable is required")
	}

	redisURL := os.Getenv("REDIS_URL")
	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "tapcash-default-production-secret-key-32bytes"
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Initialize Neon PostgreSQL Connection Pool
	pgDB, err := database.NewPostgresConnection(ctx, databaseURL)
	if err != nil {
		log.Fatalf("Database initialization failed: %v", err)
	}
	defer pgDB.Close()

	// 2. Run Database Migrations
	migrationDir := "backend/migrations"
	if err := database.RunMigrations(ctx, pgDB, migrationDir); err != nil {
		log.Printf("Migration notice: %v\n", err)
	}

	// 3. Initialize Redis / Distributed Lock Manager
	redisClient := redis.NewRedisClient(ctx, redisURL)

	// 4. Initialize Feature Services & Repositories
	authRepo := auth.NewRepository(pgDB.Pool)
	authService := auth.NewService(authRepo, jwtSecret)
	authHandler := auth.NewHandler(authService)

	walletRepo := wallet.NewRepository(pgDB.Pool)
	walletService := wallet.NewService(walletRepo)
	walletHandler := wallet.NewHandler(walletService)

	onlinePaymentService := payment_online.NewService(pgDB.Pool, redisClient)
	onlinePaymentHandler := payment_online.NewHandler(onlinePaymentService)

	syncService := offline_sync.NewService(pgDB.Pool)
	syncHandler := offline_sync.NewHandler(syncService)

	// 5. Setup Chi Router & Middlewares
	r := chi.NewRouter()
	r.Use(chiMiddleware.RequestID)
	r.Use(chiMiddleware.RealIP)
	r.Use(chiMiddleware.Logger)
	r.Use(chiMiddleware.Recoverer)
	r.Use(chiMiddleware.Timeout(60 * time.Second))

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Healthcheck
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		response.Success(w, "TapCash API is healthy", map[string]string{
			"status":    "UP",
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		})
	})

	// Mount Feature Routes
	r.Route("/api/v1", func(api chi.Router) {
		api.Mount("/auth", authHandler.Routes(jwtSecret))
		api.Mount("/wallet", walletHandler.Routes(jwtSecret))
		api.Mount("/payments/online", onlinePaymentHandler.Routes(jwtSecret))
		api.Mount("/sync", syncHandler.Routes())
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", port),
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		log.Printf("🚀 TapCash Server listening on port %s...\n", port)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down TapCash server gracefully...")
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Fatalf("Server forced shutdown: %v", err)
	}
	log.Println("TapCash Server exited cleanly.")
}
