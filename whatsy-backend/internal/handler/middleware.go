package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/whatsy/backend/pkg/utils"
)

type contextKey int

const claimsContextKey contextKey = iota

// JWTMiddleware validates Bearer tokens (Authorization header or ?token= query param).
// The query param fallback is required for WebSocket upgrades where browsers cannot set headers.
func JWTMiddleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var token string
			authorization := r.Header.Get("Authorization")
			parts := strings.Fields(authorization)
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
				token = parts[1]
			} else {
				token = r.URL.Query().Get("token")
			}
			if token == "" {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}

			claims, err := utils.ValidateToken(secret, token)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}

			ctx := context.WithValue(r.Context(), claimsContextKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ClaimsFromContext returns validated JWT claims added by JWTMiddleware.
func ClaimsFromContext(ctx context.Context) (*utils.JWTClaims, bool) {
	claims, ok := ctx.Value(claimsContextKey).(*utils.JWTClaims)
	return claims, ok
}

// RequireAdmin rejects requests from non-admin agents with 403.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := ClaimsFromContext(r.Context())
		if !ok || claims.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "admin access required"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
