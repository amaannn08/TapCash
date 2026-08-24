package offline_sync

import (
	"encoding/json"
	"net/http"

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

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/batch", h.SyncBatch)
	return r
}

func (h *Handler) SyncBatch(w http.ResponseWriter, r *http.Request) {
	var req SyncBatchRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.BatchID == "" {
		req.BatchID = uuid.New().String()
	}

	res, err := h.service.ReconcileBatch(r.Context(), req)
	if err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	response.Success(w, "offline batch reconciliation completed", res)
}
