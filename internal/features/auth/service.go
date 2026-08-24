package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/amaannn08/TapCash/internal/pkg/middleware"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

var (
	ErrEmailAlreadyExists = errors.New("email is already registered")
	ErrInvalidCredentials = errors.New("invalid email or password")
)

type Service struct {
	repo      *Repository
	jwtSecret string
}

func NewService(repo *Repository, jwtSecret string) *Service {
	return &Service{
		repo:      repo,
		jwtSecret: jwtSecret,
	}
}

func (s *Service) Register(ctx context.Context, req RegisterRequest) (*AuthResponse, error) {
	if _, err := s.repo.FindByEmail(ctx, req.Email); err == nil {
		return nil, ErrEmailAlreadyExists
	}

	hashed, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash password: %w", err)
	}

	role := "USER"
	if req.Role == "MERCHANT" {
		role = "MERCHANT"
	}

	userID := fmt.Sprintf("usr_%s", uuid.New().String())
	walletID := fmt.Sprintf("wal_%s", uuid.New().String())

	user := &User{
		ID:           userID,
		Name:         req.Name,
		Email:        req.Email,
		PasswordHash: string(hashed),
		Role:         role,
		CreatedAt:    time.Now(),
		UpdatedAt:    time.Now(),
	}

	if err := s.repo.CreateUserWithWallet(ctx, user, walletID); err != nil {
		return nil, fmt.Errorf("failed to create user: %w", err)
	}

	token, err := middleware.GenerateJWT(s.jwtSecret, user.ID, user.Email, 72*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("failed to generate token: %w", err)
	}

	return &AuthResponse{
		Token: token,
		User:  user,
	}, nil
}

func (s *Service) Login(ctx context.Context, req LoginRequest) (*AuthResponse, error) {
	user, err := s.repo.FindByEmail(ctx, req.Email)
	if err != nil {
		return nil, ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return nil, ErrInvalidCredentials
	}

	token, err := middleware.GenerateJWT(s.jwtSecret, user.ID, user.Email, 72*time.Hour)
	if err != nil {
		return nil, fmt.Errorf("failed to issue jwt: %w", err)
	}

	return &AuthResponse{
		Token: token,
		User:  user,
	}, nil
}

func (s *Service) RegisterDevice(ctx context.Context, userID string, req RegisterDeviceRequest) error {
	dk := &DeviceKey{
		ID:         fmt.Sprintf("dk_%s", uuid.New().String()),
		UserID:     userID,
		PublicKey:  req.PublicKey,
		DeviceName: req.DeviceName,
		IsActive:   true,
		CreatedAt:  time.Now(),
	}
	return s.repo.SaveDeviceKey(ctx, dk)
}

func (s *Service) GetUser(ctx context.Context, userID string) (*User, error) {
	return s.repo.FindByID(ctx, userID)
}
