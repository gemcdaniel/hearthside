package httpapi

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/gemcdaniel/hearthside/engine/sudoku"
	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
)

const healthCheckTimeout = 2 * time.Second

// Dependencies holds shared runtime collaborators injected into HTTP handlers.
type Dependencies struct {
	DB             *sql.DB
	Logger         *slog.Logger
	Config         config.Config
	OIDCHTTPClient *http.Client
	Now            func() time.Time
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
	cfg := deps.Config
	if cfg.PublicBaseURL == "" {
		cfg.PublicBaseURL = config.DefaultPublicBaseURL
	}

	var store *auth.Store
	if deps.DB != nil {
		store = auth.NewStore(deps.DB, deps.Now)
	}
	oidcClient := auth.NewOIDCClient(cfg.OIDC, cfg.PublicBaseURL, deps.OIDCHTTPClient)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/healthz", healthHandler(deps.DB))

	// Public authentication routes.
	mux.HandleFunc("GET /api/v1/auth/providers", providersHandler(store, oidcClient))
	mux.HandleFunc("POST /api/v1/auth/bootstrap", bootstrapHandler(store, cfg, logger))
	mux.HandleFunc("POST /api/v1/auth/register", registerHandler(store, cfg, logger))
	mux.HandleFunc("POST /api/v1/auth/login", loginHandler(store, cfg, logger))
	mux.HandleFunc("POST /api/v1/auth/logout", logoutHandler(store, cfg))
	mux.HandleFunc("GET /api/v1/auth/oidc/start", oidcStartHandler(store, oidcClient, cfg, deps.Now, logger))
	mux.HandleFunc("GET /api/v1/auth/oidc/callback", oidcCallbackHandler(store, oidcClient, cfg, logger))

	// Authenticated household and session routes.
	mux.Handle("GET /api/v1/auth/me", requireAuth(store, meHandler(store)))
	mux.Handle("POST /api/v1/invites", requireAuth(store, createInviteHandler(store, logger)))
	mux.Handle("GET /api/v1/invites", requireAuth(store, listInvitesHandler(store, logger)))
	mux.Handle("DELETE /api/v1/invites/{id}", requireAuth(store, revokeInviteHandler(store, logger)))
	mux.Handle("GET /api/v1/household/profiles", requireAuth(store, listProfilesHandler(store, logger)))
	mux.Handle("POST /api/v1/household/profiles", requireAuth(store, createProfileHandler(store, logger)))
	mux.Handle("PATCH /api/v1/household/profiles/{id}", requireAuth(store, updateProfileHandler(store, logger)))
	mux.Handle("DELETE /api/v1/household/profiles/{id}", requireAuth(store, deleteProfileHandler(store, logger)))

	// Strict /api boundary so unmatched API paths never fall through to SPA index.html.
	mux.HandleFunc("/api", apiNotFoundHandler)
	mux.HandleFunc("/api/", apiNotFoundHandler)

	if cfg.WebDir != "" {
		mux.Handle("/", newStaticPWAHandler(cfg.WebDir))
	}

	return RequestIDMiddleware(
		LoggingMiddleware(
			logger,
			RecoveryMiddleware(
				logger,
				CSRFMiddleware(cfg.PublicBaseURL, pathTraversalGuard(mux)),
			),
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
