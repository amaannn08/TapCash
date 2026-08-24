package wallet

import (
	"context"
	"errors"
	"fmt"
)

var ErrInvalidAmount = errors.New("amount must be greater than zero")

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

func (s *Service) GetWalletByUserID(ctx context.Context, userID string) (*Wallet, error) {
	return s.repo.GetByUserID(ctx, userID)
}

func (s *Service) FundWallet(ctx context.Context, userID string, req FundWalletRequest) (*Wallet, error) {
	if req.AmountCents <= 0 {
		return nil, ErrInvalidAmount
	}

	w, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	desc := req.Description
	if desc == "" {
		desc = fmt.Sprintf("Funded wallet with ₹%.2f", float64(req.AmountCents)/100.0)
	}

	return s.repo.FundWallet(ctx, w.ID, req.AmountCents, desc)
}

func (s *Service) AllocateOffline(ctx context.Context, userID string, req AllocateOfflineRequest) (*Wallet, error) {
	if req.AmountCents <= 0 {
		return nil, ErrInvalidAmount
	}

	w, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}

	return s.repo.AllocateOffline(ctx, w.ID, req.AmountCents)
}

func (s *Service) GetLedgerHistory(ctx context.Context, userID string, limit int) ([]LedgerEntry, error) {
	w, err := s.repo.GetByUserID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	return s.repo.GetLedgerHistory(ctx, w.ID, limit)
}
