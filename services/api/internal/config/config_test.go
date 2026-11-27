package config

import (
	"log/slog"
	"testing"
)

func mapLookup(values map[string]string) LookupFunc {
	return func(key string) (string, bool) {
		v, ok := values[key]
		return v, ok
	}
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := LoadFromLookup(mapLookup(map[string]string{}))
	if err != nil {
		t.Fatalf("LoadFromLookup returned unexpected error: %v", err)
	}

	if cfg.Addr != DefaultAddr {
		t.Fatalf("Addr = %q, want %q", cfg.Addr, DefaultAddr)
	}
	if cfg.DBPath != DefaultDBPath {
		t.Fatalf("DBPath = %q, want %q", cfg.DBPath, DefaultDBPath)
	}
	if cfg.PublicBaseURL != DefaultPublicBaseURL {
		t.Fatalf("PublicBaseURL = %q, want %q", cfg.PublicBaseURL, DefaultPublicBaseURL)
	}
	if !cfg.CookieSecure {
		t.Fatalf("CookieSecure = false, want true")
	}
	if cfg.LogLevel != slog.LevelInfo {
		t.Fatalf("LogLevel = %v, want %v", cfg.LogLevel, slog.LevelInfo)
	}
	if cfg.OIDC.Enabled() {
		t.Fatalf("OIDC.Enabled() = true, want false")
	}
}

func TestLoadCustomAndOIDC(t *testing.T) {
	cfg, err := LoadFromLookup(mapLookup(map[string]string{
		"HEARTHSIDE_ADDR":               ":9090",
		"HEARTHSIDE_DB_PATH":            "/data/custom.db",
		"HEARTHSIDE_PUBLIC_BASE_URL":    "https://hearthside.example.com/",
		"HEARTHSIDE_COOKIE_SECURE":      "false",
		"HEARTHSIDE_LOG_LEVEL":          "debug",
		"HEARTHSIDE_OIDC_ISSUER_URL":    "https://accounts.google.com/",
		"HEARTHSIDE_OIDC_CLIENT_ID":     "client-123",
		"HEARTHSIDE_OIDC_PROVIDER_NAME": "Google",
		"HEARTHSIDE_OIDC_SCOPES":        "openid email",
	}))
	if err != nil {
		t.Fatalf("LoadFromLookup returned unexpected error: %v", err)
	}

	if cfg.Addr != ":9090" {
		t.Fatalf("Addr = %q, want :9090", cfg.Addr)
	}
	if cfg.DBPath != "/data/custom.db" {
		t.Fatalf("DBPath = %q, want /data/custom.db", cfg.DBPath)
	}
	if cfg.PublicBaseURL != "https://hearthside.example.com" {
		t.Fatalf("PublicBaseURL = %q", cfg.PublicBaseURL)
	}
	if cfg.CookieSecure {
		t.Fatalf("CookieSecure = true, want false")
	}
	if cfg.LogLevel != slog.LevelDebug {
		t.Fatalf("LogLevel = %v, want debug", cfg.LogLevel)
	}
	if !cfg.OIDC.Enabled() {
		t.Fatalf("OIDC.Enabled() = false, want true")
	}
	if cfg.OIDC.IssuerURL != "https://accounts.google.com" {
		t.Fatalf("OIDC.IssuerURL = %q", cfg.OIDC.IssuerURL)
	}
	if len(cfg.OIDC.Scopes) != 2 || cfg.OIDC.Scopes[0] != "openid" || cfg.OIDC.Scopes[1] != "email" {
		t.Fatalf("OIDC.Scopes = %v", cfg.OIDC.Scopes)
	}
}

func TestLoadValidationErrors(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
	}{
		{
			name: "invalid public url",
			env:  map[string]string{"HEARTHSIDE_PUBLIC_BASE_URL": "ftp://example.com"},
		},
		{
			name: "invalid cookie secure bool",
			env:  map[string]string{"HEARTHSIDE_COOKIE_SECURE": "sometimes"},
		},
		{
			name: "invalid log level",
			env:  map[string]string{"HEARTHSIDE_LOG_LEVEL": "verbose"},
		},
		{
			name: "oidc missing client id",
			env:  map[string]string{"HEARTHSIDE_OIDC_ISSUER_URL": "https://idp.example.com"},
		},
		{
			name: "oidc missing issuer when client id set",
			env:  map[string]string{"HEARTHSIDE_OIDC_CLIENT_ID": "abc"},
		},
		{
			name: "oidc invalid issuer url",
			env: map[string]string{
				"HEARTHSIDE_OIDC_ISSUER_URL": "not-a-url",
				"HEARTHSIDE_OIDC_CLIENT_ID":  "abc",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := LoadFromLookup(mapLookup(tc.env)); err == nil {
				t.Fatalf("expected validation error for %s, got nil", tc.name)
			}
		})
	}
}
