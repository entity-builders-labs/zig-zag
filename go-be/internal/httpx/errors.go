// Package httpx holds cross-cutting HTTP infrastructure (error shaping,
// middleware, the handler adapter) shared by every domain package's
// handlers — never business logic itself.
package httpx

import (
	"encoding/json"
	"net/http"
)

// FieldError mirrors the {property, message, value} shape NestJS's global
// ValidationPipe returns from its custom exceptionFactory (be/src/main.ts).
// The frontend has no other documented 400 error contract, so this shape
// must be reproduced exactly during the migration.
type FieldError struct {
	Property string `json:"property"`
	Message  string `json:"message"`
	Value    any    `json:"value"`
}

// HTTPError is a handler-returnable error carrying the HTTP status to
// respond with. Handlers report failures by returning one of these (via
// NotFound, BadRequest, etc.) instead of writing the response themselves.
type HTTPError struct {
	Status  int
	Message string
	// Fields, when non-nil, makes WriteError emit the raw []FieldError
	// array Nest sends for validation failures instead of the
	// {statusCode,message,error} envelope used for every other error.
	Fields []FieldError
}

func (e *HTTPError) Error() string { return e.Message }

func NotFound(message string) *HTTPError {
	return &HTTPError{Status: http.StatusNotFound, Message: message}
}
func BadRequest(message string) *HTTPError {
	return &HTTPError{Status: http.StatusBadRequest, Message: message}
}
func Unauthorized(message string) *HTTPError {
	return &HTTPError{Status: http.StatusUnauthorized, Message: message}
}
func Forbidden(message string) *HTTPError {
	return &HTTPError{Status: http.StatusForbidden, Message: message}
}
func Conflict(message string) *HTTPError {
	return &HTTPError{Status: http.StatusConflict, Message: message}
}
func Internal(message string) *HTTPError {
	return &HTTPError{Status: http.StatusInternalServerError, Message: message}
}

// ValidationFailed builds the 400 Nest sends when DTO validation fails —
// the response body is the raw field-error array, not wrapped in an envelope.
func ValidationFailed(fields []FieldError) *HTTPError {
	return &HTTPError{Status: http.StatusBadRequest, Message: "Validation failed", Fields: fields}
}

// WriteError writes err's JSON body and status code to w. Errors that
// aren't *HTTPError are treated as 500s so internal detail never leaks to
// the client — callers should log the original error themselves (see
// Handle) before calling this.
func WriteError(w http.ResponseWriter, err error) {
	httpErr, ok := err.(*HTTPError)
	if !ok {
		httpErr = &HTTPError{Status: http.StatusInternalServerError, Message: "Internal server error"}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(httpErr.Status)

	if httpErr.Fields != nil {
		_ = json.NewEncoder(w).Encode(httpErr.Fields)
		return
	}

	_ = json.NewEncoder(w).Encode(map[string]any{
		"statusCode": httpErr.Status,
		"message":    httpErr.Message,
		"error":      http.StatusText(httpErr.Status),
	})
}
