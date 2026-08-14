package httpx_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

func TestWriteError(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantBody   any // decoded into map[string]any or []httpx.FieldError depending on shape
	}{
		{
			name:       "not found",
			err:        httpx.NotFound("Activity not found"),
			wantStatus: http.StatusNotFound,
			wantBody: map[string]any{
				"statusCode": float64(http.StatusNotFound),
				"message":    "Activity not found",
				"error":      "Not Found",
			},
		},
		{
			name:       "unrecognized error type is treated as a 500, detail not leaked",
			err:        errors.New("pgx: connection refused"),
			wantStatus: http.StatusInternalServerError,
			wantBody: map[string]any{
				"statusCode": float64(http.StatusInternalServerError),
				"message":    "Internal server error",
				"error":      "Internal Server Error",
			},
		},
		{
			name: "validation failure returns a raw field-error array, not an envelope",
			err: httpx.ValidationFailed([]httpx.FieldError{
				{Property: "name", Message: "name should not be empty", Value: ""},
			}),
			wantStatus: http.StatusBadRequest,
			wantBody: []any{
				map[string]any{"property": "name", "message": "name should not be empty", "value": ""},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			httpx.WriteError(rec, tt.err)

			require.Equal(t, tt.wantStatus, rec.Code)

			switch want := tt.wantBody.(type) {
			case []any:
				var got []any
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
				require.Equal(t, want, got)
			case map[string]any:
				var got map[string]any
				require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
				require.Equal(t, want, got)
			}
		})
	}
}

func TestHandle(t *testing.T) {
	t.Run("no error passes response through untouched", func(t *testing.T) {
		h := httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			return httpx.WriteJSON(w, http.StatusCreated, map[string]string{"id": "1"})
		})
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/activities", nil))
		require.Equal(t, http.StatusCreated, rec.Code)
	})

	t.Run("returned HTTPError is translated to its status", func(t *testing.T) {
		h := httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			return httpx.Conflict("already exists")
		})
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodPost, "/activities", nil))
		require.Equal(t, http.StatusConflict, rec.Code)
	})

	t.Run("unexpected error becomes a 500 without leaking its message", func(t *testing.T) {
		h := httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
			return errors.New("boom: raw internal detail")
		})
		rec := httptest.NewRecorder()
		h(rec, httptest.NewRequest(http.MethodGet, "/activities", nil))
		require.Equal(t, http.StatusInternalServerError, rec.Code)
		require.NotContains(t, rec.Body.String(), "raw internal detail")
	})
}
