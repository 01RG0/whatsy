package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/whatsy/backend/pkg/utils"
)

type contextKey int

const claimsContextKey contextKey = iota

// JWTMiddleware validates Bearer tokens and makes their claims available to
// downstream handlers through ClaimsFromContext.
func JWTMiddleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authorization := r.Header.Get("Authorization")
			parts := strings.Fields(authorization)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}

			claims, err := utils.ValidateToken(secret, parts[1])
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
