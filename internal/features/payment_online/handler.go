package payment_online

import (
	"encoding/json"
	"net/http"

	"github.com/amaannn08/TapCash/internal/pkg/middleware"
	"github.com/amaannn08/TapCash/internal/pkg/response"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
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

	r.Post("/transfer", h.Transfer)

	return r
}

func (h *Handler) Transfer(w http.ResponseWriter, r *http.Request) {
	payerUserID := middleware.GetUserIDFromContext(r.Context())
	var req OnlineTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.PayeeEmail == "" || req.AmountCents <= 0 {
		response.Error(w, http.StatusBadRequest, "payee_email and valid amount_cents are required")
		return
	}

	if req.IdempotencyKey == "" {
		req.IdempotencyKey = uuid.New().String()
	}

	res, err := h.service.Transfer(r.Context(), payerUserID, req)
	if err != nil {
		if err == ErrInsufficientFunds || err == ErrSelfTransfer || err == ErrPayeeNotFound {
			response.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	response.Success(w, "online transfer settled successfully", res)
}
