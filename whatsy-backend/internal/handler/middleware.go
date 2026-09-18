package handler

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/whatsy/backend/pkg/utils"
)

type contextKey int

const claimsContextKey contextKey = iota

// JWTMiddleware validates Bearer tokens (Authorization header or ?token= query param)
// and enforces single-session: each new login increments agents.session_version, and
// any token whose sv claim doesn't match the DB value is rejected with session_invalidated.
func JWTMiddleware(secret string, db *sql.DB) func(http.Handler) http.Handler {
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

			// Verify the session version to enforce single-session per agent.
			// Tokens issued before this column existed have sv=0; rows default to 0,
			// so existing sessions pass until the next login rotates the version.
			var dbVersion int64
			if err := db.QueryRowContext(r.Context(),
				`SELECT session_version FROM agents WHERE id = $1`, claims.AgentID,
			).Scan(&dbVersion); err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
				return
			}
			if claims.SessionVersion != dbVersion {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "session_invalidated"})
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

// RequireNotViewer rejects requests from viewer agents with 403.
func RequireNotViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := ClaimsFromContext(r.Context())
		if !ok || claims.Role == "viewer" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "read-only access: action not permitted for viewer"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

