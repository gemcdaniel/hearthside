// Package config loads and validates environment configuration for hearthside-api.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// Default configuration values for local development and containerized execution.
const (
	DefaultAddr          = ":8080"
	DefaultDBPath        = "./data/hearthside.db"
	DefaultPublicBaseURL = "http://localhost:5173"
	DefaultCookieSecure  = true
	DefaultLogLevel      = slog.LevelInfo
	DefaultOIDCScopes    = "openid profile email"
)

// OIDCConfig holds optional generic OpenID Connect provider settings.
type OIDCConfig struct {
	IssuerURL    string
	ClientID     string
	ClientSecret string
	ProviderName string
	Scopes       []string
}

// Enabled reports whether an OIDC provider is configured.
func (o OIDCConfig) Enabled() bool {
	return o.IssuerURL != ""
}

// Config contains validated runtime settings for the Hearthside API server.
type Config struct {
	Addr          string
	DBPath        string
	PublicBaseURL string
	CookieSecure  bool
	LogLevel      slog.Level
	OIDC          OIDCConfig
}

// LookupFunc resolves environment variable names to values.
type LookupFunc func(string) (string, bool)

// Load reads configuration from process environment variables.
func Load() (Config, error) {
	return LoadFromLookup(os.LookupEnv)
}

// LoadFromLookup reads and validates configuration using the supplied lookup function.
func LoadFromLookup(lookup LookupFunc) (Config, error) {
	cfg := Config{
		Addr:          DefaultAddr,
		DBPath:        DefaultDBPath,
		PublicBaseURL: DefaultPublicBaseURL,
		CookieSecure:  DefaultCookieSecure,
		LogLevel:      DefaultLogLevel,
	}

	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_ADDR"); ok {
		cfg.Addr = v
	}
	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_DB_PATH"); ok {
		cfg.DBPath = v
	}
	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_PUBLIC_BASE_URL"); ok {
		cfg.PublicBaseURL = strings.TrimRight(v, "/")
	}
	if err := validateHTTPURL("HEARTHSIDE_PUBLIC_BASE_URL", cfg.PublicBaseURL); err != nil {
		return Config{}, err
	}

	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_COOKIE_SECURE"); ok {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid HEARTHSIDE_COOKIE_SECURE %q: %w", v, err)
		}
		cfg.CookieSecure = b
	}

	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_LOG_LEVEL"); ok {
		lvl, err := ParseLogLevel(v)
		if err != nil {
			return Config{}, fmt.Errorf("invalid HEARTHSIDE_LOG_LEVEL: %w", err)
		}
		cfg.LogLevel = lvl
	}

	oidcCfg, err := loadOIDC(lookup)
	if err != nil {
		return Config{}, err
	}
	cfg.OIDC = oidcCfg

	return cfg, nil
}

// ParseLogLevel parses a string log level name into slog.Level.
func ParseLogLevel(raw string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn", "warning":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return slog.LevelInfo, fmt.Errorf("unsupported log level %q (expected debug, info, warn, or error)", raw)
	}
}

func loadOIDC(lookup LookupFunc) (OIDCConfig, error) {
	issuer, _ := lookupNonEmpty(lookup, "HEARTHSIDE_OIDC_ISSUER_URL")
	clientID, _ := lookupNonEmpty(lookup, "HEARTHSIDE_OIDC_CLIENT_ID")
	clientSecret, _ := lookupNonEmpty(lookup, "HEARTHSIDE_OIDC_CLIENT_SECRET")
	providerName, _ := lookupNonEmpty(lookup, "HEARTHSIDE_OIDC_PROVIDER_NAME")
	rawScopes, hasScopes := lookupNonEmpty(lookup, "HEARTHSIDE_OIDC_SCOPES")

	anySet := issuer != "" || clientID != "" || clientSecret != "" || providerName != "" || hasScopes
	if !anySet {
		return OIDCConfig{}, nil
	}

	if issuer == "" {
		return OIDCConfig{}, errors.New("HEARTHSIDE_OIDC_ISSUER_URL is required when OIDC settings are provided")
	}
	if err := validateHTTPURL("HEARTHSIDE_OIDC_ISSUER_URL", issuer); err != nil {
		return OIDCConfig{}, err
	}
	if clientID == "" {
		return OIDCConfig{}, errors.New("HEARTHSIDE_OIDC_CLIENT_ID is required when HEARTHSIDE_OIDC_ISSUER_URL is set")
	}

	if providerName == "" {
		providerName = "SSO"
	}
	scopesStr := DefaultOIDCScopes
	if hasScopes {
		scopesStr = rawScopes
	}

	return OIDCConfig{
		IssuerURL:    strings.TrimRight(issuer, "/"),
		ClientID:     clientID,
		ClientSecret: clientSecret,
		ProviderName: providerName,
		Scopes:       strings.Fields(scopesStr),
	}, nil
}

func validateHTTPURL(name, raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("%s must be a valid http or https URL (got %q)", name, raw)
	}
	return nil
}

func lookupNonEmpty(lookup LookupFunc, key string) (string, bool) {
	v, ok := lookup(key)
	if !ok {
		return "", false
	}
	trimmed := strings.TrimSpace(v)
	if trimmed == "" {
		return "", false
	}
	return trimmed, true
}
