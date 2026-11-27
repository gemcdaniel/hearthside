// Package httpapi provides the HTTP router, health endpoints, and middleware for hearthside-api.
package httpapi

import (
	"encoding/json"
	"net/http"
)

// ErrorBody describes a machine-readable JSON error payload.
type ErrorBody struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
}

// ErrorResponse wraps an API error object.
type ErrorResponse struct {
	Error ErrorBody `json:"error"`
}

// WriteJSON serializes payload as UTF-8 JSON with the given HTTP status code.
func WriteJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, `{"error":{"code":"encode_error","message":"failed to encode response"}}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(body)
	_, _ = w.Write([]byte("\n"))
}

// WriteError writes a structured JSON error response, including the request ID if present.
func WriteError(w http.ResponseWriter, r *http.Request, status int, code, message string) {
	var reqID string
	if r != nil {
		reqID = RequestIDFromContext(r.Context())
	}
	WriteJSON(w, status, ErrorResponse{
		Error: ErrorBody{
			Code:      code,
			Message:   message,
			RequestID: reqID,
		},
	})
}
