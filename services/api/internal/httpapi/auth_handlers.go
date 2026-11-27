package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"golang.org/x/oauth2"

	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
)

type sessionContextKey struct{}

func sessionFromContext(ctx context.Context) (auth.SessionContext, bool) {
	sc, ok := ctx.Value(sessionContextKey{}).(auth.SessionContext)
	return sc, ok
}

func requireAuth(store *auth.Store, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		cookie, err := r.Cookie(auth.SessionCookieName)
		if err != nil || strings.TrimSpace(cookie.Value) == "" {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		sc, err := store.AuthenticateSession(r.Context(), cookie.Value)
		if err != nil {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		ctx := context.WithValue(r.Context(), sessionContextKey{}, *sc)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

type authProvidersResponse struct {
	BootstrapRequired bool   `json:"bootstrapRequired"`
	EmailEnabled      bool   `json:"emailEnabled"`
	OIDCEnabled       bool   `json:"oidcEnabled"`
	OIDCProviderName  string `json:"oidcProviderName"`
}

func providersHandler(store *auth.Store, oidcClient *auth.OIDCClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		bootstrapRequired, err := store.BootstrapRequired(r.Context())
		if err != nil {
			WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to inspect auth status")
			return
		}
		WriteJSON(w, http.StatusOK, authProvidersResponse{
			BootstrapRequired: bootstrapRequired,
			EmailEnabled:      true,
			OIDCEnabled:       oidcClient.Enabled(),
			OIDCProviderName:  oidcClient.ProviderName(),
		})
	}
}

type bootstrapRequest struct {
	HouseholdName  string `json:"householdName"`
	DisplayName    string `json:"displayName"`
	Email          string `json:"email"`
	Password       string `json:"password"`
	AvatarID       string `json:"avatarId"`
	AccentColor    string `json:"accentColor"`
	BootstrapToken string `json:"bootstrapToken"`
}

func bootstrapHandler(store *auth.Store, cfg config.Config, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}

		var req bootstrapRequest
		if !decodeJSON(w, r, &req) {
			return
		}
		if req.BootstrapToken == "" {
			req.BootstrapToken = strings.TrimSpace(r.Header.Get("X-Hearthside-Bootstrap-Token"))
		}

		result, err := store.BootstrapWithPassword(r.Context(), auth.BootstrapInput{
			HouseholdName:  req.HouseholdName,
			DisplayName:    req.DisplayName,
			Email:          req.Email,
			Password:       req.Password,
			AvatarID:       req.AvatarID,
			AccentColor:    req.AccentColor,
			BootstrapToken: req.BootstrapToken,
		}, cfg.BootstrapToken)
		if err != nil {
			writeAuthError(w, r, logger, "bootstrap failed", err)
			return
		}

		auth.SetSessionCookie(w, result.RawSessionToken, cfg.CookieSecure, result.SessionExpiresAt)
		WriteJSON(w, http.StatusCreated, result)
	}
}

type registerRequest struct {
	InviteToken   string `json:"inviteToken"`
	HouseholdName string `json:"householdName"`
	DisplayName   string `json:"displayName"`
	Email         string `json:"email"`
	Password      string `json:"password"`
	AvatarID      string `json:"avatarId"`
	AccentColor   string `json:"accentColor"`
}

func registerHandler(store *auth.Store, cfg config.Config, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}

		var req registerRequest
		if !decodeJSON(w, r, &req) {
			return
		}

		result, err := store.RegisterWithInvitePassword(r.Context(), auth.RegisterInviteInput{
			InviteToken:   req.InviteToken,
			HouseholdName: req.HouseholdName,
			DisplayName:   req.DisplayName,
			Email:         req.Email,
			Password:      req.Password,
			AvatarID:      req.AvatarID,
			AccentColor:   req.AccentColor,
		})
		if err != nil {
			writeAuthError(w, r, logger, "register failed", err)
			return
		}

		auth.SetSessionCookie(w, result.RawSessionToken, cfg.CookieSecure, result.SessionExpiresAt)
		WriteJSON(w, http.StatusCreated, result)
	}
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func loginHandler(store *auth.Store, cfg config.Config, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}

		var req loginRequest
		if !decodeJSON(w, r, &req) {
			return
		}

		result, err := store.LoginWithPassword(r.Context(), req.Email, req.Password)
		if err != nil {
			writeAuthError(w, r, logger, "login failed", err)
			return
		}

		auth.SetSessionCookie(w, result.RawSessionToken, cfg.CookieSecure, result.SessionExpiresAt)
		WriteJSON(w, http.StatusOK, result)
	}
}

func logoutHandler(store *auth.Store, cfg config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store != nil {
			if cookie, err := r.Cookie(auth.SessionCookieName); err == nil && cookie.Value != "" {
				_ = store.RevokeSession(r.Context(), cookie.Value)
			}
		}
		auth.ClearSessionCookie(w, cfg.CookieSecure)
		WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func meHandler(store *auth.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}
		result, err := store.GetMe(r.Context(), sc.User.ID)
		if err != nil {
			WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to load profile")
			return
		}
		WriteJSON(w, http.StatusOK, result)
	}
}

func oidcStartHandler(store *auth.Store, oidcClient *auth.OIDCClient, cfg config.Config, nowFn func() time.Time, logger *slog.Logger) http.HandlerFunc {
	if nowFn == nil {
		nowFn = time.Now
	}
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		if !oidcClient.Enabled() {
			WriteError(w, r, http.StatusNotFound, "oidc_disabled", "OIDC authentication is not configured")
			return
		}

		q := r.URL.Query()
		inviteToken := strings.TrimSpace(q.Get("invite"))
		bootstrapParam := strings.TrimSpace(q.Get("bootstrap"))
		bootstrap := bootstrapParam == "1" || strings.EqualFold(bootstrapParam, "true")

		if inviteToken != "" && bootstrap {
			WriteError(w, r, http.StatusBadRequest, "invalid_input", "cannot combine invite and bootstrap parameters")
			return
		}

		if bootstrap {
			required, err := store.BootstrapRequired(r.Context())
			if err != nil {
				WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to inspect bootstrap state")
				return
			}
			if !required {
				WriteError(w, r, http.StatusConflict, "already_bootstrapped", "household already bootstrapped")
				return
			}
			if cfg.BootstrapToken != "" {
				provided := strings.TrimSpace(q.Get("bootstrap_token"))
				if provided == "" {
					provided = strings.TrimSpace(r.Header.Get("X-Hearthside-Bootstrap-Token"))
				}
				if !auth.ConstantTimeEqualSecret(provided, cfg.BootstrapToken) {
					WriteError(w, r, http.StatusForbidden, "invalid_bootstrap_token", "invalid bootstrap token")
					return
				}
			}
		}

		state, err := auth.GenerateToken()
		if err != nil {
			WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to initialize OIDC flow")
			return
		}
		nonce, err := auth.GenerateToken()
		if err != nil {
			WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to initialize OIDC flow")
			return
		}
		codeVerifier := oauth2.GenerateVerifier()

		authURL, err := oidcClient.StartURL(r.Context(), state, nonce, codeVerifier)
		if err != nil {
			logger.Error("oidc start url failed",
				slog.String("request_id", RequestIDFromContext(r.Context())),
			)
			WriteError(w, r, http.StatusBadGateway, "oidc_discovery_failed", "OIDC provider unavailable")
			return
		}

		var inviteHash string
		if inviteToken != "" {
			inviteHash = auth.HashToken(inviteToken)
		}

		err = store.SaveOIDCFlow(r.Context(), auth.OIDCFlow{
			StateHash:       auth.HashToken(state),
			Nonce:           nonce,
			CodeVerifier:    codeVerifier,
			InviteTokenHash: inviteHash,
			Bootstrap:       bootstrap,
			ExpiresAt:       nowFn().Add(auth.OIDCFlowTTL),
		})
		if err != nil {
			WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to persist OIDC flow")
			return
		}

		http.Redirect(w, r, authURL, http.StatusFound)
	}
}

func oidcCallbackHandler(store *auth.Store, oidcClient *auth.OIDCClient, cfg config.Config, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
			return
		}
		if !oidcClient.Enabled() {
			WriteError(w, r, http.StatusNotFound, "oidc_disabled", "OIDC authentication is not configured")
			return
		}

		q := r.URL.Query()
		if errCode := strings.TrimSpace(q.Get("error")); errCode != "" {
			WriteError(w, r, http.StatusBadRequest, "oidc_error", "OIDC provider returned an authentication error")
			return
		}

		state := strings.TrimSpace(q.Get("state"))
		code := strings.TrimSpace(q.Get("code"))
		if state == "" || code == "" {
			WriteError(w, r, http.StatusBadRequest, "invalid_oidc_callback", "missing state or authorization code")
			return
		}

		flow, err := store.ConsumeOIDCFlow(r.Context(), state)
		if err != nil {
			WriteError(w, r, http.StatusBadRequest, "invalid_oidc_state", "invalid or expired OIDC state")
			return
		}

		claims, err := oidcClient.ExchangeAndVerify(r.Context(), code, flow.CodeVerifier, flow.Nonce)
		if err != nil {
			logger.Warn("oidc token verification failed",
				slog.String("request_id", RequestIDFromContext(r.Context())),
			)
			WriteError(w, r, http.StatusUnauthorized, "oidc_verification_failed", "failed to verify OIDC identity")
			return
		}

		result, err := store.CompleteOIDCAuth(r.Context(), *flow, *claims)
		if err != nil {
			writeAuthError(w, r, logger, "oidc completion failed", err)
			return
		}

		auth.SetSessionCookie(w, result.RawSessionToken, cfg.CookieSecure, result.SessionExpiresAt)
		http.Redirect(w, r, "/", http.StatusFound)
	}
}

func writeAuthError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, contextMsg string, err error) {
	switch {
	case errors.Is(err, auth.ErrAlreadyBootstrapped):
		WriteError(w, r, http.StatusConflict, "already_bootstrapped", "household already bootstrapped")
	case errors.Is(err, auth.ErrInvalidBootstrapToken):
		WriteError(w, r, http.StatusForbidden, "invalid_bootstrap_token", "invalid bootstrap token")
	case errors.Is(err, auth.ErrInvalidCredentials):
		WriteError(w, r, http.StatusUnauthorized, "invalid_credentials", "invalid email or password")
	case errors.Is(err, auth.ErrInvalidInvite):
		WriteError(w, r, http.StatusBadRequest, "invalid_invite", "invalid, expired, or used invite token")
	case errors.Is(err, auth.ErrEmailExists):
		WriteError(w, r, http.StatusConflict, "email_exists", "an account with this email already exists")
	case errors.Is(err, auth.ErrOIDCEmailNotVerified):
		WriteError(w, r, http.StatusForbidden, "oidc_email_not_verified", "OIDC provider must verify email before linking an existing account")
	case errors.Is(err, auth.ErrConflict):
		WriteError(w, r, http.StatusConflict, "conflict", "operation conflicts with existing state")
	case errors.Is(err, auth.ErrInvalidInput):
		WriteError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
	default:
		logger.Error(contextMsg,
			slog.String("request_id", RequestIDFromContext(r.Context())),
			slog.String("error", err.Error()),
		)
		WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
