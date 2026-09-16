package utils

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTClaims contains the identity and authorization data carried by a JWT.
type JWTClaims struct {
	AgentID string `json:"agent_id"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar"`
	Role    string `json:"role"`
	jwt.RegisteredClaims
}

// GenerateToken creates a JWT that expires 24 hours after it is issued.
func GenerateToken(secret string, agentID string, name string, role string) (string, error) {
	now := time.Now()
	claims := JWTClaims{
		AgentID: agentID,
		Name:    name,
		Role:    role,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}

	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// ValidateToken verifies a JWT and returns its claims.
func ValidateToken(secret string, tokenString string) (*JWTClaims, error) {
	claims := &JWTClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}

	return claims, nil
}
