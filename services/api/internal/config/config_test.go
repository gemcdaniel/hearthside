package config

import (
	"log/slog"
	"os"
	"path/filepath"
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
	if cfg.BootstrapToken != "" {
		t.Fatalf("BootstrapToken = %q, want empty", cfg.BootstrapToken)
	}
	if cfg.WebDir != "" {
		t.Fatalf("WebDir = %q, want empty", cfg.WebDir)
	}
}

func TestLoadCustomAndOIDC(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<!doctype html>"), 0o600); err != nil {
		t.Fatalf("write index.html failed: %v", err)
	}

	cfg, err := LoadFromLookup(mapLookup(map[string]string{
		"HEARTHSIDE_ADDR":               ":9090",
		"HEARTHSIDE_DB_PATH":            "/data/custom.db",
		"HEARTHSIDE_WEB_DIR":            webDir,
		"HEARTHSIDE_PUBLIC_BASE_URL":    "https://hearthside.example.com/",
		"HEARTHSIDE_COOKIE_SECURE":      "false",
		"HEARTHSIDE_LOG_LEVEL":          "debug",
		"HEARTHSIDE_BOOTSTRAP_TOKEN":    "bootstrap-secret",
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
	if cfg.WebDir != filepath.Clean(webDir) {
		t.Fatalf("WebDir = %q, want %q", cfg.WebDir, filepath.Clean(webDir))
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
	if cfg.BootstrapToken != "bootstrap-secret" {
		t.Fatalf("BootstrapToken = %q, want bootstrap-secret", cfg.BootstrapToken)
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

func TestLoadOIDCDisabledWhenIncomplete(t *testing.T) {
	cases := []struct {
		name string
		env  map[string]string
	}{
		{
			name: "only scopes and provider name set",
			env: map[string]string{
				"HEARTHSIDE_OIDC_PROVIDER_NAME": "Google",
				"HEARTHSIDE_OIDC_SCOPES":        "openid profile email",
			},
		},
		{
			name: "missing client id",
			env: map[string]string{
				"HEARTHSIDE_OIDC_ISSUER_URL": "https://idp.example.com",
			},
		},
		{
			name: "missing issuer url",
			env: map[string]string{
				"HEARTHSIDE_OIDC_CLIENT_ID": "abc",
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg, err := LoadFromLookup(mapLookup(tc.env))
			if err != nil {
				t.Fatalf("expected OIDC to cleanly disable without error, got: %v", err)
			}
			if cfg.OIDC.Enabled() {
				t.Fatalf("OIDC.Enabled() = true, want false")
			}
		})
	}
}

func TestLoadWebDirValidationErrors(t *testing.T) {
	emptyDir := t.TempDir()
	regularFile := filepath.Join(emptyDir, "not-a-dir")
	if err := os.WriteFile(regularFile, []byte("hi"), 0o600); err != nil {
		t.Fatalf("write file failed: %v", err)
	}

	for _, tc := range []struct {
		name string
		val  string
	}{
		{name: "missing path", val: filepath.Join(emptyDir, "missing")},
		{name: "not a directory", val: regularFile},
		{name: "missing index.html", val: emptyDir},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := LoadFromLookup(mapLookup(map[string]string{"HEARTHSIDE_WEB_DIR": tc.val})); err == nil {
				t.Fatalf("expected error for HEARTHSIDE_WEB_DIR=%q, got nil", tc.val)
			}
		})
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
