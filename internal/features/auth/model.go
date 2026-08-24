package auth

import "time"

type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type DeviceKey struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	PublicKey  string    `json:"public_key"`
	DeviceName string    `json:"device_name"`
	IsActive   bool      `json:"is_active"`
	CreatedAt  time.Time `json:"created_at"`
}

type RegisterRequest struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type LoginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type RegisterDeviceRequest struct {
	PublicKey  string `json:"public_key"`
	DeviceName string `json:"device_name"`
}

type AuthResponse struct {
	Token string `json:"token"`
	User  *User  `json:"user"`
}
