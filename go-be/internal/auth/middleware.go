package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

type contextKey int

const userContextKey contextKey = iota

// RequireAuth mirrors JwtAuthGuard: requires a valid Bearer access token
// (verified against accessSecret) and injects the resulting RequestUser
// into the request context for downstream handlers.
func RequireAuth(accessSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || token == "" {
				httpx.WriteError(w, httpx.Unauthorized("Unauthorized"))
				return
			}

			claims, err := VerifyToken(token, accessSecret)
			if err != nil {
				httpx.WriteError(w, httpx.Unauthorized("Unauthorized"))
				return
			}

			ctx := context.WithValue(r.Context(), userContextKey, RequestUser{
				ID:    claims.Subject,
				Email: claims.Email,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserFromContext retrieves the RequestUser set by RequireAuth.
func UserFromContext(ctx context.Context) (RequestUser, bool) {
	u, ok := ctx.Value(userContextKey).(RequestUser)
	return u, ok
}
