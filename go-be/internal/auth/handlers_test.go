package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/juanobrach/zig-zag/go-be/internal/auth"
	"github.com/juanobrach/zig-zag/go-be/internal/auth/mocks"
	"github.com/juanobrach/zig-zag/go-be/internal/db/sqlcgen"
)

func newTestServer(t *testing.T, svc *auth.Service, isProduction bool) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	h := auth.NewHandlers(svc, isProduction)
	h.Register(mux, auth.RequireAuth("access-secret"))
	return httptest.NewServer(mux)
}

func TestHandlers_LoginWithGoogle(t *testing.T) {
	t.Run("success returns 200 with the session", func(t *testing.T) {
		db := mocks.NewQuerier(t)
		google := mocks.NewGoogleVerifier(t)
		google.EXPECT().Verify(mock.Anything, "id-token").Return(auth.VerifiedGoogleUser{ProviderID: "g-1", Email: "person@example.com"}, nil)
		db.EXPECT().GetUserByProviderID(mock.Anything, mock.Anything).Return(sqlcgen.User{}, pgx.ErrNoRows)
		db.EXPECT().CreateUser(mock.Anything, mock.Anything).Return(sqlcgen.User{ID: "u-1", Email: "person@example.com"}, nil)
		db.EXPECT().SetUserRefreshTokenHash(mock.Anything, mock.Anything).Return(nil)

		svc := newTestService(db, google, mocks.NewAppleVerifier(t))
		srv := newTestServer(t, svc, false)
		defer srv.Close()

		resp := postJSON(t, srv.URL+"/auth/google", map[string]string{"idToken": "id-token"})
		defer resp.Body.Close()
		require.Equal(t, http.StatusOK, resp.StatusCode)

		var body auth.AuthResult
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
		require.Equal(t, "person@example.com", body.User.Email)
		require.NotEmpty(t, body.AccessToken)
	})

	t.Run("empty idToken returns 400 with the Nest field-error shape", func(t *testing.T) {
		svc := newTestService(mocks.NewQuerier(t), mocks.NewGoogleVerifier(t), mocks.NewAppleVerifier(t))
		srv := newTestServer(t, svc, false)
		defer srv.Close()

		resp := postJSON(t, srv.URL+"/auth/google", map[string]string{"idToken": ""})
		defer resp.Body.Close()
		require.Equal(t, http.StatusBadRequest, resp.StatusCode)

		var body []map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
		require.Len(t, body, 1)
		require.Equal(t, "idToken", body[0]["property"])
	})

	t.Run("invalid token from the verifier maps to 401", func(t *testing.T) {
		google := mocks.NewGoogleVerifier(t)
		google.EXPECT().Verify(mock.Anything, "bad-token").Return(auth.VerifiedGoogleUser{}, auth.ErrInvalidGoogleToken)

		svc := newTestService(mocks.NewQuerier(t), google, mocks.NewAppleVerifier(t))
		srv := newTestServer(t, svc, false)
		defer srv.Close()

		resp := postJSON(t, srv.URL+"/auth/google", map[string]string{"idToken": "bad-token"})
		defer resp.Body.Close()
		require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})
}

func TestHandlers_RequestEmailCode_DevCodeOutsideProduction(t *testing.T) {
	db := mocks.NewQuerier(t)
	mailer := mocks.NewMailer(t)
	db.EXPECT().GetLastEmailLoginCode(mock.Anything, "person@example.com").Return(sqlcgen.EmailLoginCode{}, pgx.ErrNoRows)
	db.EXPECT().CreateEmailLoginCode(mock.Anything, mock.Anything).Return(sqlcgen.EmailLoginCode{}, nil)
	mailer.EXPECT().SendLoginCode(mock.Anything, "person@example.com", mock.Anything).Return(nil)

	otp := auth.NewOTPService(db, mailer, auth.OTPConfig{TTL: 1, MaxAttempts: 5, ResendCooldown: 1})
	svc := auth.NewService(db, mocks.NewGoogleVerifier(t), mocks.NewAppleVerifier(t), otp, testTokenConfig())

	t.Run("devCode present outside production", func(t *testing.T) {
		srv := newTestServer(t, svc, false)
		defer srv.Close()

		resp := postJSON(t, srv.URL+"/auth/email/request-code", map[string]string{"email": "person@example.com"})
		defer resp.Body.Close()
		require.Equal(t, http.StatusOK, resp.StatusCode)

		var body map[string]any
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
		require.Contains(t, body, "devCode")
	})
}

func TestHandlers_GuardedRoutes(t *testing.T) {
	db := mocks.NewQuerier(t)
	svc := newTestService(db, mocks.NewGoogleVerifier(t), mocks.NewAppleVerifier(t))
	srv := newTestServer(t, svc, false)
	defer srv.Close()

	t.Run("GET /auth/me without a token is 401", func(t *testing.T) {
		resp, err := http.Get(srv.URL + "/auth/me")
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	})

	t.Run("GET /auth/me with a valid token reaches the handler", func(t *testing.T) {
		db.EXPECT().GetUserByID(mock.Anything, "u-1").Return(sqlcgen.User{ID: "u-1", Email: "person@example.com"}, nil)

		token, err := auth.SignToken("u-1", "person@example.com", "access-secret", 15*time.Minute)
		require.NoError(t, err)

		req, _ := http.NewRequest(http.MethodGet, srv.URL+"/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		require.NoError(t, err)
		defer resp.Body.Close()
		require.Equal(t, http.StatusOK, resp.StatusCode)

		var body auth.AuthUser
		require.NoError(t, json.NewDecoder(resp.Body).Decode(&body))
		require.Equal(t, "person@example.com", body.Email)
	})
}

func postJSON(t *testing.T, url string, body any) *http.Response {
	t.Helper()
	data, err := json.Marshal(body)
	require.NoError(t, err)
	resp, err := http.Post(url, "application/json", bytes.NewReader(data))
	require.NoError(t, err)
	return resp
}
