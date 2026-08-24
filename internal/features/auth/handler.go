package auth

import (
	"encoding/json"
	"net/http"

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

	// Public routes
	r.Post("/register", h.Register)
	r.Post("/login", h.Login)

	// Protected routes
	r.Group(func(pr chi.Router) {
		pr.Use(middleware.AuthMiddleware(jwtSecret))
		pr.Post("/device/register", h.RegisterDevice)
		pr.Get("/me", h.Me)
	})

	return r
}

func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Email == "" || req.Password == "" || req.Name == "" {
		response.Error(w, http.StatusBadRequest, "name, email, and password are required")
		return
	}

	res, err := h.service.Register(r.Context(), req)
	if err != nil {
		if err == ErrEmailAlreadyExists {
			response.Error(w, http.StatusConflict, err.Error())
			return
		}
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	response.Success(w, "user registered successfully", res)
}

func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	res, err := h.service.Login(r.Context(), req)
	if err != nil {
		response.Error(w, http.StatusUnauthorized, err.Error())
		return
	}

	response.Success(w, "login successful", res)
}

func (h *Handler) RegisterDevice(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserIDFromContext(r.Context())
	var req RegisterDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.PublicKey == "" {
		response.Error(w, http.StatusBadRequest, "public_key is required")
		return
	}

	if err := h.service.RegisterDevice(r.Context(), userID, req); err != nil {
		response.Error(w, http.StatusInternalServerError, err.Error())
		return
	}

	response.Success(w, "device key registered successfully", nil)
}

func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserIDFromContext(r.Context())
	user, err := h.service.GetUser(r.Context(), userID)
	if err != nil {
		response.Error(w, http.StatusNotFound, "user not found")
		return
	}

	response.Success(w, "user profile retrieved", user)
}
