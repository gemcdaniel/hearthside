package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

func TestHealthzOK(t *testing.T) {
	ctx := context.Background()
	database, err := db.Open(ctx, ":memory:")
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	defer func() {
		_ = database.Close()
	}()

	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	handler := NewHandler(Dependencies{
		DB:     database,
		Logger: logger,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz?email=secret@example.com", nil)
	req.Header.Set("X-Request-ID", "test-req-1")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotReqID := rec.Header().Get("X-Request-ID"); gotReqID != "test-req-1" {
		t.Fatalf("X-Request-ID = %q, want test-req-1", gotReqID)
	}

	var payload HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if payload.Status != "ok" || payload.DB != "ok" || payload.Service != "hearthside-api" {
		t.Fatalf("unexpected health payload: %+v", payload)
	}
	if payload.EngineVersion != sudoku.Version() {
		t.Fatalf("EngineVersion = %q, want %q", payload.EngineVersion, sudoku.Version())
	}

	logged := logBuf.String()
	if !strings.Contains(logged, `"path":"/api/v1/healthz"`) || !strings.Contains(logged, `"status":200`) {
		t.Fatalf("expected structured access log entry, got: %s", logged)
	}
	if strings.Contains(logged, "secret@example.com") {
		t.Fatalf("access log must never include query string / PII: %s", logged)
	}
}

func TestHealthzDegradedWhenDBClosed(t *testing.T) {
	ctx := context.Background()
	database, err := db.Open(ctx, ":memory:")
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	_ = database.Close()

	handler := NewHandler(Dependencies{DB: database})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if rec.Header().Get("X-Request-ID") == "" {
		t.Fatalf("expected generated X-Request-ID header")
	}

	var payload HealthResponse
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response failed: %v", err)
	}
	if payload.Status != "degraded" || payload.DB != "error" {
		t.Fatalf("unexpected degraded payload: %+v", payload)
	}
}

func TestRecoveryMiddlewareReturnsJSON500(t *testing.T) {
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))

	panicMux := http.NewServeMux()
	panicMux.HandleFunc("GET /panic", func(_ http.ResponseWriter, _ *http.Request) {
		panic("boom")
	})

	handler := RequestIDMiddleware(LoggingMiddleware(logger, RecoveryMiddleware(logger, panicMux)))
	req := httptest.NewRequest(http.MethodGet, "/panic", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}

	var errResp ErrorResponse
	if err := json.NewDecoder(rec.Body).Decode(&errResp); err != nil {
		t.Fatalf("decode error response failed: %v", err)
	}
	if errResp.Error.Code != "internal_error" || errResp.Error.RequestID == "" {
		t.Fatalf("unexpected error payload: %+v", errResp)
	}
}
