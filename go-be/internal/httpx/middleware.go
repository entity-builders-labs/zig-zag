package httpx

import (
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/juanobrach/zig-zag/go-be/internal/config"
)

// Chain composes middleware in application order: Chain(a, b)(h) behaves
// like a(b(h)) — the request passes through a, then b, then h.
func Chain(mws ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(h http.Handler) http.Handler {
		for i := len(mws) - 1; i >= 0; i-- {
			h = mws[i](h)
		}
		return h
	}
}

// CORS mirrors main.ts's app.enableCors() call: origin "*" (the literal
// config value, not an array) reflects any Origin; otherwise only the
// configured comma-separated origins are allowed. Always sends
// Access-Control-Allow-Credentials, matching { credentials: true } there.
func CORS(cfg config.CORSConfig) func(http.Handler) http.Handler {
	allowed := cfg.AllowedOrigins()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" && (cfg.AllowAny() || slices.Contains(allowed, origin)) {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequestLogger logs one structured line per request, matching the intent
// of main.ts's morgan + "Incoming <method> <url>" debug middleware.
func RequestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		slog.InfoContext(r.Context(), "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Recoverer turns a panic in a handler into a 500 response instead of
// crashing the process.
func Recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.ErrorContext(r.Context(), "panic recovered", "panic", rec, "path", r.URL.Path)
				WriteError(w, Internal("Internal server error"))
			}
		}()
		next.ServeHTTP(w, r)
	})
}
