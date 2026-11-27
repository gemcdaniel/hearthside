package httpapi

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

type mockOIDCIdentity struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	ForceNonce    string
}

type mockOIDCServer struct {
	server *httptest.Server
	key    *rsa.PrivateKey
	kid    string

	mu           sync.Mutex
	nextIdentity mockOIDCIdentity
	codes        map[string]mockOIDCCode
	tokenCalls   int
}

type mockOIDCCode struct {
	Challenge       string
	ChallengeMethod string
	Nonce           string
	Identity        mockOIDCIdentity
}

func newMockOIDCServer(t *testing.T) *mockOIDCServer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	m := &mockOIDCServer{
		key:   key,
		kid:   "test-key-1",
		codes: make(map[string]mockOIDCCode),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		WriteJSON(w, http.StatusOK, map[string]any{
			"issuer":                                m.server.URL,
			"authorization_endpoint":                m.server.URL + "/authorize",
			"token_endpoint":                        m.server.URL + "/token",
			"jwks_uri":                              m.server.URL + "/jwks",
			"response_types_supported":              []string{"code"},
			"subject_types_supported":               []string{"public"},
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})

	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, _ *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(m.key.N.Bytes())
		eBytes := big.NewInt(int64(m.key.E)).Bytes()
		e := base64.RawURLEncoding.EncodeToString(eBytes)
		WriteJSON(w, http.StatusOK, map[string]any{
			"keys": []map[string]any{
				{
					"kty": "RSA",
					"use": "sig",
					"alg": "RS256",
					"kid": m.kid,
					"n":   n,
					"e":   e,
				},
			},
		})
	})

	mux.HandleFunc("GET /authorize", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		state := q.Get("state")
		redirectURI := q.Get("redirect_uri")

		m.mu.Lock()
		code, _ := auth.GenerateToken()
		m.codes[code] = mockOIDCCode{
			Challenge:       q.Get("code_challenge"),
			ChallengeMethod: q.Get("code_challenge_method"),
			Nonce:           q.Get("nonce"),
			Identity:        m.nextIdentity,
		}
		m.mu.Unlock()

		u, err := url.Parse(redirectURI)
		if err != nil {
			http.Error(w, "bad redirect_uri", http.StatusBadRequest)
			return
		}
		rq := u.Query()
		rq.Set("code", code)
		rq.Set("state", state)
		u.RawQuery = rq.Encode()
		http.Redirect(w, r, u.String(), http.StatusFound)
	})

	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			http.Error(w, "bad form", http.StatusBadRequest)
			return
		}
		code := r.FormValue("code")
		verifier := r.FormValue("code_verifier")

		m.mu.Lock()
		entry, ok := m.codes[code]
		if ok {
			delete(m.codes, code)
		}
		m.tokenCalls++
		m.mu.Unlock()

		if !ok {
			http.Error(w, "unknown code", http.StatusBadRequest)
			return
		}
		if entry.ChallengeMethod != "S256" {
			http.Error(w, "expected PKCE S256", http.StatusBadRequest)
			return
		}
		sum := sha256.Sum256([]byte(verifier))
		if base64.RawURLEncoding.EncodeToString(sum[:]) != entry.Challenge {
			http.Error(w, "PKCE verifier mismatch", http.StatusBadRequest)
			return
		}

		nonce := entry.Nonce
		if entry.Identity.ForceNonce != "" {
			nonce = entry.Identity.ForceNonce
		}

		now := time.Now().UTC()
		idToken := m.signJWT(t, map[string]any{
			"iss":            m.server.URL,
			"sub":            entry.Identity.Subject,
			"aud":            "hearthside-test-client",
			"exp":            now.Add(5 * time.Minute).Unix(),
			"iat":            now.Unix(),
			"nonce":          nonce,
			"email":          entry.Identity.Email,
			"email_verified": entry.Identity.EmailVerified,
			"name":           entry.Identity.Name,
		})

		WriteJSON(w, http.StatusOK, map[string]any{
			"access_token": "mock-access-token",
			"token_type":   "Bearer",
			"expires_in":   3600,
			"id_token":     idToken,
		})
	})

	m.server = httptest.NewServer(mux)
	t.Cleanup(m.server.Close)
	return m
}

func (m *mockOIDCServer) setIdentity(id mockOIDCIdentity) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.nextIdentity = id
}

func (m *mockOIDCServer) signJWT(t *testing.T, claims map[string]any) string {
	t.Helper()
	headerBytes, err := json.Marshal(map[string]any{
		"alg": "RS256",
		"typ": "JWT",
		"kid": m.kid,
	})
	if err != nil {
		t.Fatalf("marshal jwt header: %v", err)
	}
	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal jwt payload: %v", err)
	}

	signingInput := base64.RawURLEncoding.EncodeToString(headerBytes) + "." + base64.RawURLEncoding.EncodeToString(payloadBytes)
	digest := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, m.key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign jwt: %v", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
}

func runOIDCBrowserFlow(t *testing.T, apiHandler http.Handler, startPath string) (*httptest.ResponseRecorder, string) {
	t.Helper()
	startReq := httptest.NewRequest(http.MethodGet, startPath, nil)
	startRec := httptest.NewRecorder()
	apiHandler.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusFound {
		return startRec, ""
	}

	authLocation := startRec.Header().Get("Location")
	idpClient := &http.Client{
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	idpResp, err := idpClient.Get(authLocation)
	if err != nil {
		t.Fatalf("GET mock IdP authorize failed: %v", err)
	}
	_ = idpResp.Body.Close()
	if idpResp.StatusCode != http.StatusFound {
		t.Fatalf("IdP authorize status = %d, want 302", idpResp.StatusCode)
	}

	callbackURL := idpResp.Header.Get("Location")
	cbReq := httptest.NewRequest(http.MethodGet, callbackURL, nil)
	cbRec := httptest.NewRecorder()
	apiHandler.ServeHTTP(cbRec, cbReq)
	return cbRec, callbackURL
}

func TestOIDCDisabledReturns404(t *testing.T) {
	env := newTestAPIEnv(t, nil)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/start", nil)
	rec := httptest.NewRecorder()
	env.handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("disabled OIDC start = %d, want 404", rec.Code)
	}
}

func TestOIDCEndToEndWithMockProvider(t *testing.T) {
	idp := newMockOIDCServer(t)

	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "oidc.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	defer func() {
		_ = database.Close()
	}()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	// API starts cleanly without blocking on OIDC discovery (lazy discovery).
	cfg := config.Config{
		Addr:          config.DefaultAddr,
		PublicBaseURL: testPublicBaseURL,
		CookieSecure:  false,
		LogLevel:      config.DefaultLogLevel,
		OIDC: config.OIDCConfig{
			IssuerURL:    idp.server.URL,
			ClientID:     "hearthside-test-client",
			ClientSecret: "test-client-secret",
			ProviderName: "Family SSO",
			Scopes:       []string{"openid", "profile", "email"},
		},
	}
	handler := NewHandler(Dependencies{
		DB:             database,
		Config:         cfg,
		OIDCHTTPClient: idp.server.Client(),
	})

	// 1. Providers reports OIDC enabled with custom provider name.
	provRec := httptest.NewRecorder()
	handler.ServeHTTP(provRec, httptest.NewRequest(http.MethodGet, "/api/v1/auth/providers", nil))
	if !strings.Contains(provRec.Body.String(), `"oidcEnabled":true`) || !strings.Contains(provRec.Body.String(), `"oidcProviderName":"Family SSO"`) {
		t.Fatalf("unexpected providers body: %s", provRec.Body.String())
	}

	// 2. OIDC bootstrap creates household + owner + session cookie.
	idp.setIdentity(mockOIDCIdentity{
		Subject:       "sub-owner",
		Email:         "sso-owner@example.com",
		EmailVerified: true,
		Name:          "SSO Owner",
	})
	cbRec, cbURL := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start?bootstrap=1")
	if cbRec.Code != http.StatusFound || cbRec.Header().Get("Location") != "/" {
		t.Fatalf("OIDC bootstrap callback status=%d loc=%q body=%s", cbRec.Code, cbRec.Header().Get("Location"), cbRec.Body.String())
	}
	ownerCookie := extractSessionCookie(t, cbRec)

	// Replaying the same OIDC state/code callback must be rejected.
	replayRec := httptest.NewRecorder()
	handler.ServeHTTP(replayRec, httptest.NewRequest(http.MethodGet, cbURL, nil))
	if replayRec.Code != http.StatusBadRequest {
		t.Fatalf("replayed OIDC callback status = %d, want 400", replayRec.Code)
	}

	// Verify /me succeeds as owner.
	meReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	meReq.AddCookie(ownerCookie)
	meRec := httptest.NewRecorder()
	handler.ServeHTTP(meRec, meReq)
	if meRec.Code != http.StatusOK || !strings.Contains(meRec.Body.String(), `"role":"owner"`) {
		t.Fatalf("GET /me after OIDC bootstrap failed: %d %s", meRec.Code, meRec.Body.String())
	}

	// 3. Second bootstrap via OIDC fails with 409 Conflict.
	secondBootReq := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oidc/start?bootstrap=1", nil)
	secondBootRec := httptest.NewRecorder()
	handler.ServeHTTP(secondBootRec, secondBootReq)
	if secondBootRec.Code != http.StatusConflict {
		t.Fatalf("repeat OIDC bootstrap start = %d, want 409", secondBootRec.Code)
	}

	// 4. Returning OIDC user signs in without invite.
	retRec, _ := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start")
	if retRec.Code != http.StatusFound {
		t.Fatalf("returning OIDC login = %d, want 302", retRec.Code)
	}

	// 5. Mismatched nonce is rejected with 401.
	idp.setIdentity(mockOIDCIdentity{
		Subject:       "sub-owner",
		Email:         "sso-owner@example.com",
		EmailVerified: true,
		Name:          "SSO Owner",
		ForceNonce:    "tampered-nonce",
	})
	badNonceRec, _ := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start")
	if badNonceRec.Code != http.StatusUnauthorized {
		t.Fatalf("mismatched nonce status = %d, want 401", badNonceRec.Code)
	}

	// 6. Invite signup via OIDC works and rejects unknown uninvited OIDC users.
	invReq := httptest.NewRequest(http.MethodPost, "/api/v1/invites", strings.NewReader(`{"mode":"join_household"}`))
	invReq.Header.Set("Origin", testPublicBaseURL)
	invReq.Header.Set("Content-Type", "application/json")
	invReq.AddCookie(ownerCookie)
	invRec := httptest.NewRecorder()
	handler.ServeHTTP(invRec, invReq)
	var invResp createInviteResponse
	_ = json.NewDecoder(invRec.Body).Decode(&invResp)

	idp.setIdentity(mockOIDCIdentity{
		Subject:       "sub-invited-partner",
		Email:         "sso-partner@example.com",
		EmailVerified: true,
		Name:          "SSO Partner",
	})
	inviteCBRec, _ := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start?invite="+url.QueryEscape(invResp.Token))
	if inviteCBRec.Code != http.StatusFound {
		t.Fatalf("OIDC invite signup = %d (%s)", inviteCBRec.Code, inviteCBRec.Body.String())
	}

	// Uninvited stranger is rejected.
	idp.setIdentity(mockOIDCIdentity{
		Subject:       "sub-stranger",
		Email:         "stranger@example.com",
		EmailVerified: true,
		Name:          "Stranger",
	})
	strangerRec, _ := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start")
	if strangerRec.Code != http.StatusBadRequest {
		t.Fatalf("uninvited stranger OIDC login = %d, want 400", strangerRec.Code)
	}

	// 7. Create an uninvited second password adult via invite, then test auto-linking guard:
	//    email_verified=false is rejected (403); email_verified=true auto-links and logs in (302).
	inv2Req := httptest.NewRequest(http.MethodPost, "/api/v1/invites", strings.NewReader(`{"mode":"join_household"}`))
	inv2Req.Header.Set("Origin", testPublicBaseURL)
	inv2Req.Header.Set("Content-Type", "application/json")
	inv2Req.AddCookie(ownerCookie)
	inv2Rec := httptest.NewRecorder()
	handler.ServeHTTP(inv2Rec, inv2Req)
	var inv2Resp createInviteResponse
	_ = json.NewDecoder(inv2Rec.Body).Decode(&inv2Resp)

	regReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(
		`{"inviteToken":"`+inv2Resp.Token+`","displayName":"Pw User","email":"pw-user@example.com","password":"pw-user-long-password"}`,
	))
	regReq.Header.Set("Origin", testPublicBaseURL)
	regReq.Header.Set("Content-Type", "application/json")
	regRec := httptest.NewRecorder()
	handler.ServeHTTP(regRec, regReq)
	if regRec.Code != http.StatusCreated {
		t.Fatalf("password register = %d", regRec.Code)
	}

	idp.setIdentity(mockOIDCIdentity{
		Subject:       "sub-pw-user",
		Email:         "pw-user@example.com",
		EmailVerified: false,
		Name:          "Pw User",
	})
	unverifiedRec, _ := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start")
	if unverifiedRec.Code != http.StatusForbidden {
		t.Fatalf("unverified email auto-link status = %d, want 403", unverifiedRec.Code)
	}

	idp.setIdentity(mockOIDCIdentity{
		Subject:       "sub-pw-user",
		Email:         "pw-user@example.com",
		EmailVerified: true,
		Name:          "Pw User",
	})
	verifiedRec, _ := runOIDCBrowserFlow(t, handler, "/api/v1/auth/oidc/start")
	if verifiedRec.Code != http.StatusFound {
		t.Fatalf("verified email auto-link status = %d, want 302 (%s)", verifiedRec.Code, verifiedRec.Body.String())
	}
}
