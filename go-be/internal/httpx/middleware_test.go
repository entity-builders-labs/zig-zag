package httpx_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/config"
	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

func TestCORS(t *testing.T) {
	tests := []struct {
		name           string
		corsOrigin     string
		requestOrigin  string
		method         string
		wantAllowedHdr string // expected Access-Control-Allow-Origin, "" means absent
		wantStatus     int
	}{
		{
			name:           "wildcard config reflects any origin",
			corsOrigin:     "*",
			requestOrigin:  "https://anything.example.com",
			method:         http.MethodGet,
			wantAllowedHdr: "https://anything.example.com",
			wantStatus:     http.StatusOK,
		},
		{
			name:           "allowlisted origin is echoed back",
			corsOrigin:     "https://zigzag.app,https://staging.zigzag.app",
			requestOrigin:  "https://staging.zigzag.app",
			method:         http.MethodGet,
			wantAllowedHdr: "https://staging.zigzag.app",
			wantStatus:     http.StatusOK,
		},
		{
			name:           "origin not on the allowlist gets no CORS header",
			corsOrigin:     "https://zigzag.app",
			requestOrigin:  "https://evil.example.com",
			method:         http.MethodGet,
			wantAllowedHdr: "",
			wantStatus:     http.StatusOK,
		},
		{
			name:           "preflight OPTIONS short-circuits with 204",
			corsOrigin:     "*",
			requestOrigin:  "https://anything.example.com",
			method:         http.MethodOptions,
			wantAllowedHdr: "https://anything.example.com",
			wantStatus:     http.StatusNoContent,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var handlerCalled bool
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				handlerCalled = true
				w.WriteHeader(http.StatusOK)
			})

			mw := httpx.CORS(config.CORSConfig{Origin: tt.corsOrigin})(next)

			req := httptest.NewRequest(tt.method, "/activities", nil)
			req.Header.Set("Origin", tt.requestOrigin)
			rec := httptest.NewRecorder()

			mw.ServeHTTP(rec, req)

			require.Equal(t, tt.wantStatus, rec.Code)
			require.Equal(t, tt.wantAllowedHdr, rec.Header().Get("Access-Control-Allow-Origin"))
			if tt.method == http.MethodOptions {
				require.False(t, handlerCalled, "preflight should not reach the wrapped handler")
			} else {
				require.True(t, handlerCalled)
			}
		})
	}
}
