package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// HandlerFunc is like http.HandlerFunc but returns an error — handlers
// report failures via a returned *HTTPError (NotFound, BadRequest, ...)
// instead of writing the response body themselves, keeping the handler
// layer thin per the project's "no business logic in handlers" standard.
type HandlerFunc func(w http.ResponseWriter, r *http.Request) error

// Handle adapts a HandlerFunc to http.HandlerFunc, logging and translating
// any returned error into the appropriate JSON error response.
func Handle(fn HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := fn(w, r); err != nil {
			if _, ok := err.(*HTTPError); !ok {
				slog.ErrorContext(r.Context(), "unhandled handler error", "error", err, "path", r.URL.Path)
			}
			WriteError(w, err)
		}
	}
}

// WriteJSON writes v as a JSON response body with the given status code.
func WriteJSON(w http.ResponseWriter, status int, v any) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	return json.NewEncoder(w).Encode(v)
}
