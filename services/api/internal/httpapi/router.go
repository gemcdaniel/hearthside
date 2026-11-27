package httpapi

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
)

const healthCheckTimeout = 2 * time.Second

// Dependencies holds shared runtime collaborators injected into HTTP handlers.
type Dependencies struct {
	DB     *sql.DB
	Logger *slog.Logger
}

// HealthResponse represents the payload returned by GET /api/v1/healthz.
type HealthResponse struct {
	Status        string `json:"status"`
	Service       string `json:"service"`
	EngineVersion string `json:"engineVersion"`
	DB            string `json:"db"`
}

// NewHandler constructs the root HTTP handler with middleware and registered routes.
func NewHandler(deps Dependencies) http.Handler {
	logger := deps.Logger
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/healthz", healthHandler(deps.DB))

	return RequestIDMiddleware(
		LoggingMiddleware(
			logger,
			RecoveryMiddleware(logger, mux),
		),
	)
}

func healthHandler(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), healthCheckTimeout)
		defer cancel()

		resp := HealthResponse{
			Status:        "ok",
			Service:       "hearthside-api",
			EngineVersion: sudoku.Version(),
			DB:            "ok",
		}

		if database == nil {
			resp.Status = "degraded"
			resp.DB = "error"
			WriteJSON(w, http.StatusServiceUnavailable, resp)
			return
		}

		if err := database.PingContext(ctx); err != nil {
			resp.Status = "degraded"
			resp.DB = "error"
			WriteJSON(w, http.StatusServiceUnavailable, resp)
			return
		}

		WriteJSON(w, http.StatusOK, resp)
	}
}
