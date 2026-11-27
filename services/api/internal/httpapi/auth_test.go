package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

const testPublicBaseURL = "http://localhost:5173"

type testAPIEnv struct {
	handler http.Handler
	logBuf  *bytes.Buffer
	now     *time.Time
}

func newTestAPIEnv(t *testing.T, modifyCfg func(*config.Config)) *testAPIEnv {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "api.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	var logBuf bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logBuf, nil))
	cfg := config.Config{
		Addr:          config.DefaultAddr,
		PublicBaseURL: testPublicBaseURL,
		CookieSecure:  false,
		LogLevel:      slog.LevelInfo,
	}
	if modifyCfg != nil {
		modifyCfg(&cfg)
	}

	handler := NewHandler(Dependencies{
		DB:     database,
		Logger: logger,
		Config: cfg,
		Now:    func() time.Time { return now },
	})

	return &testAPIEnv{
		handler: handler,
		logBuf:  &logBuf,
		now:     &now,
	}
}

func (e *testAPIEnv) doJSON(t *testing.T, method, path string, body any, cookie *http.Cookie, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode request body: %v", err)
		}
	}

	req := httptest.NewRequest(method, path, &buf)
	if method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions {
		req.Header.Set("Origin", testPublicBaseURL)
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}

	rec := httptest.NewRecorder()
	e.handler.ServeHTTP(rec, req)
	return rec
}

func extractSessionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.SessionCookieName {
			return c
		}
	}
	t.Fatalf("expected %s cookie in response", auth.SessionCookieName)
	return nil
}

func TestBootstrapFlowAndTokenGuard(t *testing.T) {
	env := newTestAPIEnv(t, func(cfg *config.Config) {
		cfg.BootstrapToken = "family-init-secret"
	})

	// 1. Providers initially require bootstrap and have OIDC disabled.
	rec := env.doJSON(t, http.MethodGet, "/api/v1/auth/providers", nil, nil, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET providers = %d, want 200", rec.Code)
	}
	var providers authProvidersResponse
	if err := json.NewDecoder(rec.Body).Decode(&providers); err != nil {
		t.Fatalf("decode providers: %v", err)
	}
	if !providers.BootstrapRequired || !providers.EmailEnabled || providers.OIDCEnabled {
		t.Fatalf("unexpected providers response: %+v", providers)
	}

	// 2. Wrong bootstrap token rejected.
	bad := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]any{
		"householdName":  "The Hearth",
		"displayName":    "Parent",
		"email":          "parent@example.com",
		"password":       "very-secure-passphrase",
		"bootstrapToken": "wrong-secret",
	}, nil, nil)
	if bad.Code != http.StatusForbidden {
		t.Fatalf("bad bootstrap token status = %d, want 403", bad.Code)
	}

	// 3. Valid bootstrap succeeds once and sets HttpOnly session cookie.
	okRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]any{
		"householdName":  "The Hearth",
		"displayName":    "Parent",
		"email":          "Parent@Example.com",
		"password":       "very-secure-passphrase",
		"bootstrapToken": "family-init-secret",
	}, nil, nil)
	if okRec.Code != http.StatusCreated {
		t.Fatalf("bootstrap status = %d, want 201 (%s)", okRec.Code, okRec.Body.String())
	}
	cookie := extractSessionCookie(t, okRec)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("expected HttpOnly SameSite=Lax cookie, got %+v", cookie)
	}

	var bootResult auth.Result
	if err := json.NewDecoder(okRec.Body).Decode(&bootResult); err != nil {
		t.Fatalf("decode bootstrap response: %v", err)
	}
	if bootResult.User.Role != auth.RoleOwner || len(bootResult.Profiles) != 1 || bootResult.Profiles[0].IsChild {
		t.Fatalf("unexpected bootstrap payload: %+v", bootResult)
	}

	// 4. Repeat bootstrap permanently fails with 409 Conflict.
	repeat := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]any{
		"householdName":  "Another Home",
		"displayName":    "Intruder",
		"email":          "other@example.com",
		"password":       "very-secure-passphrase",
		"bootstrapToken": "family-init-secret",
	}, nil, nil)
	if repeat.Code != http.StatusConflict {
		t.Fatalf("repeat bootstrap status = %d, want 409", repeat.Code)
	}

	// 5. Providers now report bootstrapRequired: false and /me succeeds with cookie.
	rec = env.doJSON(t, http.MethodGet, "/api/v1/auth/providers", nil, nil, nil)
	if err := json.NewDecoder(rec.Body).Decode(&providers); err != nil {
		t.Fatalf("decode providers after bootstrap: %v", err)
	}
	if providers.BootstrapRequired {
		t.Fatalf("expected bootstrapRequired = false after bootstrap")
	}

	meRec := env.doJSON(t, http.MethodGet, "/api/v1/auth/me", nil, cookie, nil)
	if meRec.Code != http.StatusOK {
		t.Fatalf("GET /me = %d, want 200", meRec.Code)
	}

	// Logs must never include PII or secrets.
	logs := env.logBuf.String()
	for _, sensitive := range []string{"very-secure-passphrase", "family-init-secret", "parent@example.com", cookie.Value} {
		if strings.Contains(logs, sensitive) {
			t.Fatalf("logs leaked sensitive value %q: %s", sensitive, logs)
		}
	}
}

func TestInvitesLoginLogoutAndCrossHouseholdIsolation(t *testing.T) {
	env := newTestAPIEnv(t, nil)

	// Bootstrap Household A owner.
	bootRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/bootstrap", map[string]any{
		"householdName": "Household A",
		"displayName":   "Owner A",
		"email":         "owner-a@example.com",
		"password":      "owner-a-password-123",
	}, nil, nil)
	if bootRec.Code != http.StatusCreated {
		t.Fatalf("bootstrap = %d", bootRec.Code)
	}
	ownerACookie := extractSessionCookie(t, bootRec)

	var bootA auth.Result
	if err := json.NewDecoder(bootRec.Body).Decode(&bootA); err != nil {
		t.Fatalf("decode bootA: %v", err)
	}

	// Unauthenticated /me and /invites fail with 401.
	if unauth := env.doJSON(t, http.MethodGet, "/api/v1/auth/me", nil, nil, nil); unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauth /me = %d, want 401", unauth.Code)
	}
	if unauth := env.doJSON(t, http.MethodGet, "/api/v1/invites", nil, nil, nil); unauth.Code != http.StatusUnauthorized {
		t.Fatalf("unauth /invites = %d, want 401", unauth.Code)
	}

	// Owner A creates join_household invite.
	invRec := env.doJSON(t, http.MethodPost, "/api/v1/invites", map[string]any{
		"mode":      "join_household",
		"emailHint": "partner-a@example.com",
	}, ownerACookie, nil)
	if invRec.Code != http.StatusCreated {
		t.Fatalf("create invite = %d (%s)", invRec.Code, invRec.Body.String())
	}
	var joinInviteResp createInviteResponse
	if err := json.NewDecoder(invRec.Body).Decode(&joinInviteResp); err != nil {
		t.Fatalf("decode invite resp: %v", err)
	}
	if joinInviteResp.Token == "" || joinInviteResp.Invite.Status != "active" {
		t.Fatalf("unexpected invite response: %+v", joinInviteResp)
	}

	// Partner A registers with join_household invite.
	regARec := env.doJSON(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"inviteToken": joinInviteResp.Token,
		"displayName": "Partner A",
		"email":       "partner-a@example.com",
		"password":    "partner-a-password-123",
	}, nil, nil)
	if regARec.Code != http.StatusCreated {
		t.Fatalf("register join_household = %d (%s)", regARec.Code, regARec.Body.String())
	}
	var regA auth.Result
	if err := json.NewDecoder(regARec.Body).Decode(&regA); err != nil {
		t.Fatalf("decode regA: %v", err)
	}
	if regA.Household.ID != bootA.Household.ID || regA.User.Role != auth.RoleAdult {
		t.Fatalf("expected Partner A to join Household A as adult, got %+v", regA)
	}

	// Replay same invite fails.
	replayRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"inviteToken": joinInviteResp.Token,
		"displayName": "Replay",
		"email":       "replay@example.com",
		"password":    "replay-password-123",
	}, nil, nil)
	if replayRec.Code != http.StatusBadRequest {
		t.Fatalf("replayed invite = %d, want 400", replayRec.Code)
	}

	// Owner A creates child profile in Household A.
	childRec := env.doJSON(t, http.MethodPost, "/api/v1/household/profiles", map[string]any{
		"isChild":     true,
		"name":        "Kiddo A",
		"avatarId":    "fox",
		"accentColor": "amber",
	}, ownerACookie, nil)
	if childRec.Code != http.StatusCreated {
		t.Fatalf("create child = %d (%s)", childRec.Code, childRec.Body.String())
	}
	var childWrap struct {
		Profile auth.Profile `json:"profile"`
	}
	if err := json.NewDecoder(childRec.Body).Decode(&childWrap); err != nil {
		t.Fatalf("decode child: %v", err)
	}
	if !childWrap.Profile.IsChild || childWrap.Profile.UserID != nil {
		t.Fatalf("expected child profile without userId, got %+v", childWrap.Profile)
	}

	// Owner A creates new_household invite and redeems as Household B owner.
	invBRec := env.doJSON(t, http.MethodPost, "/api/v1/invites", map[string]any{
		"mode": "new_household",
	}, ownerACookie, nil)
	if invBRec.Code != http.StatusCreated {
		t.Fatalf("create new_household invite = %d", invBRec.Code)
	}
	var invB createInviteResponse
	if err := json.NewDecoder(invBRec.Body).Decode(&invB); err != nil {
		t.Fatalf("decode invB: %v", err)
	}

	regBRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"inviteToken":   invB.Token,
		"householdName": "Household B",
		"displayName":   "Owner B",
		"email":         "owner-b@example.com",
		"password":      "owner-b-password-123",
	}, nil, nil)
	if regBRec.Code != http.StatusCreated {
		t.Fatalf("register new_household = %d", regBRec.Code)
	}
	ownerBCookie := extractSessionCookie(t, regBRec)
	var regB auth.Result
	if err := json.NewDecoder(regBRec.Body).Decode(&regB); err != nil {
		t.Fatalf("decode regB: %v", err)
	}
	if regB.Household.ID == bootA.Household.ID || regB.User.Role != auth.RoleOwner {
		t.Fatalf("expected separate Household B owner, got %+v", regB)
	}

	// Cross-household isolation: Owner B cannot list, patch, or delete Household A resources.
	listBInvites := env.doJSON(t, http.MethodGet, "/api/v1/invites", nil, ownerBCookie, nil)
	if !strings.Contains(listBInvites.Body.String(), `"invites":[]`) {
		t.Fatalf("expected Household B invites empty, got %s", listBInvites.Body.String())
	}

	// Create revocable invite in A, verify B gets 404 trying to revoke it, then A revokes it.
	revokableRec := env.doJSON(t, http.MethodPost, "/api/v1/invites", map[string]any{"mode": "join_household"}, ownerACookie, nil)
	var revokable createInviteResponse
	_ = json.NewDecoder(revokableRec.Body).Decode(&revokable)

	if crossRevoke := env.doJSON(t, http.MethodDelete, "/api/v1/invites/"+revokable.Invite.ID, nil, ownerBCookie, nil); crossRevoke.Code != http.StatusNotFound {
		t.Fatalf("cross-household revoke invite = %d, want 404", crossRevoke.Code)
	}
	if revokeOK := env.doJSON(t, http.MethodDelete, "/api/v1/invites/"+revokable.Invite.ID, nil, ownerACookie, nil); revokeOK.Code != http.StatusOK {
		t.Fatalf("owner revoke invite = %d, want 200", revokeOK.Code)
	}
	if useRevoked := env.doJSON(t, http.MethodPost, "/api/v1/auth/register", map[string]any{
		"inviteToken": revokable.Token,
		"displayName": "Late",
		"email":       "late@example.com",
		"password":    "late-password-123",
	}, nil, nil); useRevoked.Code != http.StatusBadRequest {
		t.Fatalf("revoked invite register = %d, want 400", useRevoked.Code)
	}

	// Cross-household profile mutations return 404.
	newName := "Hijacked"
	if crossPatch := env.doJSON(t, http.MethodPatch, "/api/v1/household/profiles/"+childWrap.Profile.ID, map[string]any{"name": newName}, ownerBCookie, nil); crossPatch.Code != http.StatusNotFound {
		t.Fatalf("cross-household patch child = %d, want 404", crossPatch.Code)
	}
	if crossDelete := env.doJSON(t, http.MethodDelete, "/api/v1/household/profiles/"+childWrap.Profile.ID, nil, ownerBCookie, nil); crossDelete.Code != http.StatusNotFound {
		t.Fatalf("cross-household delete child = %d, want 404", crossDelete.Code)
	}

	// Adult profile cannot be deleted, child profile can be updated and deleted by Owner A.
	if delAdult := env.doJSON(t, http.MethodDelete, "/api/v1/household/profiles/"+bootA.Profiles[0].ID, nil, ownerACookie, nil); delAdult.Code != http.StatusForbidden {
		t.Fatalf("delete adult profile = %d, want 403", delAdult.Code)
	}
	if patchChild := env.doJSON(t, http.MethodPatch, "/api/v1/household/profiles/"+childWrap.Profile.ID, map[string]any{"name": "Kiddo Updated"}, ownerACookie, nil); patchChild.Code != http.StatusOK {
		t.Fatalf("patch child = %d, want 200", patchChild.Code)
	}
	if delChild := env.doJSON(t, http.MethodDelete, "/api/v1/household/profiles/"+childWrap.Profile.ID, nil, ownerACookie, nil); delChild.Code != http.StatusOK {
		t.Fatalf("delete child = %d, want 200", delChild.Code)
	}

	// Wrong login fails with 401; valid login succeeds; logout revokes session cookie.
	if badLogin := env.doJSON(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email":    "owner-a@example.com",
		"password": "wrong-password-123",
	}, nil, nil); badLogin.Code != http.StatusUnauthorized {
		t.Fatalf("bad login = %d, want 401", badLogin.Code)
	}
	loginRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/login", map[string]any{
		"email":    "owner-a@example.com",
		"password": "owner-a-password-123",
	}, nil, nil)
	if loginRec.Code != http.StatusOK {
		t.Fatalf("valid login = %d, want 200", loginRec.Code)
	}
	loginCookie := extractSessionCookie(t, loginRec)

	logoutRec := env.doJSON(t, http.MethodPost, "/api/v1/auth/logout", nil, loginCookie, nil)
	if logoutRec.Code != http.StatusOK {
		t.Fatalf("logout = %d, want 200", logoutRec.Code)
	}
	if meAfterLogout := env.doJSON(t, http.MethodGet, "/api/v1/auth/me", nil, loginCookie, nil); meAfterLogout.Code != http.StatusUnauthorized {
		t.Fatalf("/me after logout = %d, want 401", meAfterLogout.Code)
	}

	// Expired session fails when clock advances past SessionTTL.
	*env.now = env.now.Add(auth.SessionTTL + time.Minute)
	if meExpired := env.doJSON(t, http.MethodGet, "/api/v1/auth/me", nil, ownerACookie, nil); meExpired.Code != http.StatusUnauthorized {
		t.Fatalf("/me with expired session = %d, want 401", meExpired.Code)
	}
}

func TestCSRFAndContentTypeChecks(t *testing.T) {
	env := newTestAPIEnv(t, nil)

	// Cross-origin Origin rejected with 403.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@b.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin status = %d, want 403", rec.Code)
	}

	// Missing Origin and Referer rejected with 403.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@b.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing origin/referer status = %d, want 403", rec.Code)
	}

	// Same-origin Referer fallback passes CSRF check (reaches invalid_credentials 401).
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"a@b.com","password":"password123"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Referer", testPublicBaseURL+"/login")
	rec = httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("same-origin referer login status = %d, want 401", rec.Code)
	}

	// Non-JSON Content-Type rejected with 415.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`email=a@b.com`))
	req.Header.Set("Origin", testPublicBaseURL)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec = httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("wrong content-type status = %d, want 415", rec.Code)
	}
}
