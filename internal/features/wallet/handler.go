package wallet

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/amaannn08/TapCash/internal/pkg/middleware"
	"github.com/amaannn08/TapCash/internal/pkg/response"
	"github.com/go-chi/chi/v5"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Routes(jwtSecret string) chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(jwtSecret))

	r.Get("/me", h.GetMyWallet)
	r.Post("/fund", h.FundWallet)
	r.Post("/allocate-offline", h.AllocateOffline)
	r.Get("/ledger", h.GetLedger)

	return r
}

func (h *Handler) GetMyWallet(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserIDFromContext(r.Context())
	wallet, err := h.service.GetWalletByUserID(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, err.Error())
		return
	}
	response.Success(w, "wallet fetched successfully", wallet)
}

func (h *Handler) FundWallet(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserIDFromContext(r.Context())
	var req FundWalletRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	wallet, err := h.service.FundWallet(r.Context(), userID, req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	response.Success(w, "wallet funded successfully", wallet)
}

func (h *Handler) AllocateOffline(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserIDFromContext(r.Context())
	var req AllocateOfflineRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	wallet, err := h.service.AllocateOffline(r.Context(), userID, req)
	if err != nil {
		response.Error(w, http.StatusBadRequest, err.Error())
		return
	}

	response.Success(w, "offline allocation updated successfully", wallet)
}

func (h *Handler) GetLedger(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserIDFromContext(r.Context())
	limitStr := r.URL.Query().Get("limit")
	limit := 50
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil {
			limit = parsed
		}
	}

	entries, err := h.service.GetLedgerHistory(r.Context(), userID, limit)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	response.Success(w, "ledger history retrieved", entries)
}
