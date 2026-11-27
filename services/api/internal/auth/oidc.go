package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/gemcdaniel/hearthside/services/api/internal/config"
)

const oidcDiscoveryTimeout = 10 * time.Second

// OIDCClaims represents verified identity claims extracted from an OIDC ID token.
type OIDCClaims struct {
	Issuer        string
	Subject       string
	Email         string
	EmailVerified bool
	DisplayName   string
}

// OIDCClient performs lazy OIDC Discovery, PKCE authorization URL generation, and token verification.
type OIDCClient struct {
	cfg           config.OIDCConfig
	publicBaseURL string
	httpClient    *http.Client

	mu        sync.Mutex
	oauth2Cfg *oauth2.Config
	verifier  *oidc.IDTokenVerifier
}

// NewOIDCClient creates a lazy OIDC client bound to cfg and publicBaseURL.
func NewOIDCClient(cfg config.OIDCConfig, publicBaseURL string, httpClient *http.Client) *OIDCClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: oidcDiscoveryTimeout}
	}
	return &OIDCClient{
		cfg:           cfg,
		publicBaseURL: strings.TrimRight(publicBaseURL, "/"),
		httpClient:    httpClient,
	}
}

// Enabled reports whether an OIDC provider is configured.
func (c *OIDCClient) Enabled() bool {
	return c != nil && c.cfg.Enabled()
}

// ProviderName returns the configured display label for the OIDC provider.
func (c *OIDCClient) ProviderName() string {
	if c == nil || !c.cfg.Enabled() {
		return ""
	}
	return c.cfg.ProviderName
}

// StartURL constructs the PKCE Authorization Code redirect URL for state, nonce, and codeVerifier.
func (c *OIDCClient) StartURL(ctx context.Context, state, nonce, codeVerifier string) (string, error) {
	if !c.Enabled() {
		return "", ErrOIDCDisabled
	}

	oauth2Cfg, _, err := c.ensureDiscovered(ctx)
	if err != nil {
		return "", err
	}

	url := oauth2Cfg.AuthCodeURL(
		state,
		oauth2.S256ChallengeOption(codeVerifier),
		oidc.Nonce(nonce),
	)
	return url, nil
}

// ExchangeAndVerify exchanges the authorization code using PKCE and verifies the returned ID token and nonce.
func (c *OIDCClient) ExchangeAndVerify(ctx context.Context, code, codeVerifier, expectedNonce string) (*OIDCClaims, error) {
	if !c.Enabled() {
		return nil, ErrOIDCDisabled
	}
	if strings.TrimSpace(code) == "" {
		return nil, fmt.Errorf("%w: missing authorization code", ErrInvalidInput)
	}

	oauth2Cfg, verifier, err := c.ensureDiscovered(ctx)
	if err != nil {
		return nil, err
	}

	reqCtx := c.clientContext(ctx)
	tok, err := oauth2Cfg.Exchange(reqCtx, code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return nil, fmt.Errorf("exchange authorization code: %w", err)
	}

	rawIDToken, ok := tok.Extra("id_token").(string)
	if !ok || strings.TrimSpace(rawIDToken) == "" {
		return nil, errors.New("token response missing id_token")
	}

	idToken, err := verifier.Verify(reqCtx, rawIDToken)
	if err != nil {
		return nil, fmt.Errorf("verify id_token: %w", err)
	}

	if !ConstantTimeEqualSecret(idToken.Nonce, expectedNonce) {
		return nil, errors.New("id_token nonce mismatch")
	}

	var claims struct {
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("decode id_token claims: %w", err)
	}

	email := strings.TrimSpace(claims.Email)
	displayName := strings.TrimSpace(claims.Name)
	if displayName == "" {
		displayName = strings.TrimSpace(claims.PreferredUsername)
	}
	if displayName == "" && email != "" {
		if local, _, hasAt := strings.Cut(email, "@"); hasAt && local != "" {
			displayName = local
		}
	}
	if displayName == "" {
		displayName = "Household Member"
	}

	return &OIDCClaims{
		Issuer:        idToken.Issuer,
		Subject:       idToken.Subject,
		Email:         email,
		EmailVerified: claims.EmailVerified,
		DisplayName:   displayName,
	}, nil
}

func (c *OIDCClient) ensureDiscovered(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.oauth2Cfg != nil && c.verifier != nil {
		return c.oauth2Cfg, c.verifier, nil
	}

	reqCtx, cancel := context.WithTimeout(c.clientContext(ctx), oidcDiscoveryTimeout)
	defer cancel()

	provider, err := oidc.NewProvider(reqCtx, c.cfg.IssuerURL)
	if err != nil {
		return nil, nil, fmt.Errorf("oidc discovery: %w", err)
	}

	scopes := slices.Clone(c.cfg.Scopes)
	if !slices.Contains(scopes, oidc.ScopeOpenID) {
		scopes = append([]string{oidc.ScopeOpenID}, scopes...)
	}

	oauth2Cfg := &oauth2.Config{
		ClientID:     c.cfg.ClientID,
		ClientSecret: c.cfg.ClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  c.publicBaseURL + "/api/v1/auth/oidc/callback",
		Scopes:       scopes,
	}
	verifier := provider.Verifier(&oidc.Config{
		ClientID: c.cfg.ClientID,
	})

	c.oauth2Cfg = oauth2Cfg
	c.verifier = verifier
	return oauth2Cfg, verifier, nil
}

func (c *OIDCClient) clientContext(ctx context.Context) context.Context {
	reqCtx := oidc.ClientContext(ctx, c.httpClient)
	return context.WithValue(reqCtx, oauth2.HTTPClient, c.httpClient)
}
