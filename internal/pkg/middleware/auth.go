package middleware

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/amaannn08/TapCash/internal/pkg/response"
	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserIDContextKey contextKey = "user_id"

type Claims struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

// GenerateJWT creates a signed JWT string.
func GenerateJWT(secret, userID, email string, ttl time.Duration) (string, error) {
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// AuthMiddleware validates JWT Bearer token and injects UserID into request context.
func AuthMiddleware(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				response.Error(w, http.StatusUnauthorized, "missing authorization header")
				return
			}

			parts := strings.Split(authHeader, " ")
			if len(parts) != 2 || strings.ToLower(parts[0]) != "bearer" {
				response.Error(w, http.StatusUnauthorized, "invalid authorization token format")
				return
			}

			tokenStr := parts[1]
			claims := &Claims{}
			token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
				return []byte(jwtSecret), nil
			})

			if err != nil || !token.Valid {
				response.Error(w, http.StatusUnauthorized, "invalid or expired token")
				return
			}

			ctx := context.WithValue(r.Context(), UserIDContextKey, claims.UserID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetUserIDFromContext retrieves the authenticated user ID.
func GetUserIDFromContext(ctx context.Context) string {
	if val, ok := ctx.Value(UserIDContextKey).(string); ok {
		return val
	}
	return ""
}
