package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/juanobrach/zig-zag/go-be/internal/httpx"
)

// Handlers ports AuthController (be/src/modules/auth/controllers/auth.controller.ts).
type Handlers struct {
	svc          *Service
	isProduction bool
}

func NewHandlers(svc *Service, isProduction bool) *Handlers {
	return &Handlers{svc: svc, isProduction: isProduction}
}

// Register wires every /auth route onto mux. requireAuth is applied only
// to /logout and /me, mirroring @UseGuards(JwtAuthGuard) being present on
// just those two routes in Nest — the rest of the auth surface is
// necessarily unauthenticated (you don't have a token yet).
func (h *Handlers) Register(mux *http.ServeMux, requireAuth func(http.Handler) http.Handler) {
	mux.HandleFunc("POST /auth/google", httpx.Handle(h.loginWithGoogle))
	mux.HandleFunc("POST /auth/apple", httpx.Handle(h.loginWithApple))
	mux.HandleFunc("POST /auth/email/request-code", httpx.Handle(h.requestEmailCode))
	mux.HandleFunc("POST /auth/email/verify", httpx.Handle(h.verifyEmailCode))
	mux.HandleFunc("POST /auth/refresh", httpx.Handle(h.refresh))
	mux.Handle("POST /auth/logout", requireAuth(httpx.Handle(h.logout)))
	mux.Handle("GET /auth/me", requireAuth(httpx.Handle(h.me)))
}

func decodeJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}

// --- POST /auth/google ---

type googleLoginRequest struct {
	IDToken string `json:"idToken"`
}

func (req googleLoginRequest) validate() []httpx.FieldError {
	var errs []httpx.FieldError
	if strings.TrimSpace(req.IDToken) == "" {
		errs = append(errs, httpx.FieldError{Property: "idToken", Message: "idToken should not be empty", Value: req.IDToken})
	}
	return errs
}

func (h *Handlers) loginWithGoogle(w http.ResponseWriter, r *http.Request) error {
	var req googleLoginRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	result, err := h.svc.LoginWithGoogle(r.Context(), req.IDToken)
	if err != nil {
		return authError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}

// --- POST /auth/apple ---

type appleLoginRequest struct {
	IdentityToken string  `json:"identityToken"`
	FullName      *string `json:"fullName"`
}

func (req appleLoginRequest) validate() []httpx.FieldError {
	var errs []httpx.FieldError
	if strings.TrimSpace(req.IdentityToken) == "" {
		errs = append(errs, httpx.FieldError{Property: "identityToken", Message: "identityToken should not be empty", Value: req.IdentityToken})
	}
	return errs
}

func (h *Handlers) loginWithApple(w http.ResponseWriter, r *http.Request) error {
	var req appleLoginRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	result, err := h.svc.LoginWithApple(r.Context(), req.IdentityToken, req.FullName)
	if err != nil {
		return authError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}

// --- POST /auth/email/request-code ---

type requestEmailCodeRequest struct {
	Email string `json:"email"`
}

func (req requestEmailCodeRequest) validate() []httpx.FieldError {
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return []httpx.FieldError{{Property: "email", Message: "email must be an email", Value: req.Email}}
	}
	return nil
}

func (h *Handlers) requestEmailCode(w http.ResponseWriter, r *http.Request) error {
	var req requestEmailCodeRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	code, err := h.svc.RequestEmailCode(r.Context(), req.Email)
	if err != nil {
		return authError(err)
	}

	// Outside production there's no real inbox to read from (dev/E2E use
	// fake or unconfigured SMTP), so the code rides along in the response —
	// mirrors AuthController.requestEmailCode exactly.
	resp := map[string]any{"message": "Código enviado."}
	if !h.isProduction {
		resp["devCode"] = code
	}
	return httpx.WriteJSON(w, http.StatusOK, resp)
}

// --- POST /auth/email/verify ---

type verifyEmailCodeRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

func (req verifyEmailCodeRequest) validate() []httpx.FieldError {
	var errs []httpx.FieldError
	if _, err := mail.ParseAddress(req.Email); err != nil {
		errs = append(errs, httpx.FieldError{Property: "email", Message: "email must be an email", Value: req.Email})
	}
	if len(req.Code) != 6 {
		errs = append(errs, httpx.FieldError{Property: "code", Message: "code must be longer than or equal to 6 and shorter than or equal to 6 characters", Value: req.Code})
	}
	return errs
}

func (h *Handlers) verifyEmailCode(w http.ResponseWriter, r *http.Request) error {
	var req verifyEmailCodeRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	result, err := h.svc.LoginWithEmailCode(r.Context(), req.Email, req.Code)
	if err != nil {
		return authError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}

// --- POST /auth/refresh ---

type refreshRequest struct {
	RefreshToken string `json:"refreshToken"`
}

func (req refreshRequest) validate() []httpx.FieldError {
	var errs []httpx.FieldError
	if strings.TrimSpace(req.RefreshToken) == "" {
		errs = append(errs, httpx.FieldError{Property: "refreshToken", Message: "refreshToken should not be empty", Value: req.RefreshToken})
	}
	return errs
}

func (h *Handlers) refresh(w http.ResponseWriter, r *http.Request) error {
	var req refreshRequest
	if err := decodeJSON(r, &req); err != nil {
		return httpx.BadRequest("invalid request body")
	}
	if errs := req.validate(); len(errs) > 0 {
		return httpx.ValidationFailed(errs)
	}

	result, err := h.svc.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		return authError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, result)
}

// --- POST /auth/logout (guarded) ---

func (h *Handlers) logout(w http.ResponseWriter, r *http.Request) error {
	user, ok := UserFromContext(r.Context())
	if !ok {
		return httpx.Unauthorized("Unauthorized")
	}
	if err := h.svc.Logout(r.Context(), user.ID); err != nil {
		return authError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, map[string]string{"message": "Logged out."})
}

// --- GET /auth/me (guarded) ---

func (h *Handlers) me(w http.ResponseWriter, r *http.Request) error {
	user, ok := UserFromContext(r.Context())
	if !ok {
		return httpx.Unauthorized("Unauthorized")
	}
	authUser, err := h.svc.GetByID(r.Context(), user.ID)
	if err != nil {
		return authError(err)
	}
	return httpx.WriteJSON(w, http.StatusOK, authUser)
}

// authError maps Service's sentinel errors to the right HTTP status,
// matching the *Exception types AuthService/EmailOtpService throw in Nest.
func authError(err error) error {
	switch {
	case errors.Is(err, ErrInvalidRefreshToken),
		errors.Is(err, ErrInvalidOrExpiredCode),
		errors.Is(err, ErrTooManyAttempts),
		errors.Is(err, ErrEmailRequiredForFirstSignIn),
		errors.Is(err, ErrInvalidGoogleToken),
		errors.Is(err, ErrInvalidAppleToken):
		return httpx.Unauthorized(err.Error())
	case errors.Is(err, ErrResendTooSoon):
		return httpx.BadRequest(err.Error())
	case errors.Is(err, ErrEmailAlreadyInUse):
		return httpx.Conflict(err.Error())
	case errors.Is(err, pgx.ErrNoRows):
		return httpx.NotFound("not found")
	default:
		return httpx.Internal("Internal server error")
	}
}
