// Package config loads and validates environment configuration for hearthside-api.
package config

import (
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Default configuration values for local development and containerized execution.
const (
	DefaultAddr                   = ":8080"
	DefaultDBPath                 = "./data/hearthside.db"
	DefaultPublicBaseURL          = "http://localhost:5173"
	DefaultCookieSecure           = true
	DefaultLogLevel               = slog.LevelInfo
	DefaultOIDCScopes             = "openid profile email"
	DefaultPuzzleSchedulerEnabled = true
	DefaultPuzzlePoolTarget       = 50
	DefaultPuzzlePoolLowWater     = 20
	DefaultPuzzlePoolMaxTotal     = 2000
	DefaultDailyLookaheadDays     = 7
)

// PuzzleConfig controls server-side puzzle bank generation and daily pre-generation.
type PuzzleConfig struct {
	SchedulerEnabled   bool
	PoolTarget         int
	PoolLowWater       int
	PoolMaxTotal       int
	DailyLookaheadDays int
}

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
	return o.IssuerURL != "" && o.ClientID != ""
}

// Config contains validated runtime settings for the Hearthside API server.
type Config struct {
	Addr           string
	DBPath         string
	WebDir         string
	PublicBaseURL  string
	CookieSecure   bool
	LogLevel       slog.Level
	BootstrapToken string
	OIDC           OIDCConfig
	Puzzles        PuzzleConfig
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
	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_WEB_DIR"); ok {
		cleaned := filepath.Clean(v)
		if err := validateWebDir(cleaned); err != nil {
			return Config{}, err
		}
		cfg.WebDir = cleaned
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

	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_BOOTSTRAP_TOKEN"); ok {
		cfg.BootstrapToken = v
	}

	oidcCfg, err := loadOIDC(lookup)
	if err != nil {
		return Config{}, err
	}
	cfg.OIDC = oidcCfg

	puzzleCfg, err := loadPuzzleConfig(lookup)
	if err != nil {
		return Config{}, err
	}
	cfg.Puzzles = puzzleCfg

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

	// OIDC is cleanly disabled whenever either issuer URL or client ID is empty.
	if issuer == "" || clientID == "" {
		return OIDCConfig{}, nil
	}

	if err := validateHTTPURL("HEARTHSIDE_OIDC_ISSUER_URL", issuer); err != nil {
		return OIDCConfig{}, err
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

func validateWebDir(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("HEARTHSIDE_WEB_DIR %q is not accessible: %w", dir, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("HEARTHSIDE_WEB_DIR %q must be a directory", dir)
	}
	indexPath := filepath.Join(dir, "index.html")
	indexInfo, err := os.Stat(indexPath)
	if err != nil {
		return fmt.Errorf("HEARTHSIDE_WEB_DIR %q must contain index.html: %w", dir, err)
	}
	if indexInfo.IsDir() {
		return fmt.Errorf("HEARTHSIDE_WEB_DIR %q index.html must be a regular file", dir)
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

func loadPuzzleConfig(lookup LookupFunc) (PuzzleConfig, error) {
	pc := PuzzleConfig{
		SchedulerEnabled:   DefaultPuzzleSchedulerEnabled,
		PoolTarget:         DefaultPuzzlePoolTarget,
		PoolLowWater:       DefaultPuzzlePoolLowWater,
		PoolMaxTotal:       DefaultPuzzlePoolMaxTotal,
		DailyLookaheadDays: DefaultDailyLookaheadDays,
	}

	if v, ok := lookupNonEmpty(lookup, "HEARTHSIDE_PUZZLE_SCHEDULER_ENABLED"); ok {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return PuzzleConfig{}, fmt.Errorf("invalid HEARTHSIDE_PUZZLE_SCHEDULER_ENABLED %q: %w", v, err)
		}
		pc.SchedulerEnabled = b
	}

	if err := parseBoundedInt(lookup, "HEARTHSIDE_PUZZLE_POOL_TARGET", 1, 10000, &pc.PoolTarget); err != nil {
		return PuzzleConfig{}, err
	}
	if err := parseBoundedInt(lookup, "HEARTHSIDE_PUZZLE_POOL_LOW_WATER", 0, 10000, &pc.PoolLowWater); err != nil {
		return PuzzleConfig{}, err
	}
	if err := parseBoundedInt(lookup, "HEARTHSIDE_PUZZLE_POOL_MAX_TOTAL", 1, 100000, &pc.PoolMaxTotal); err != nil {
		return PuzzleConfig{}, err
	}
	if err := parseBoundedInt(lookup, "HEARTHSIDE_DAILY_LOOKAHEAD_DAYS", 0, 365, &pc.DailyLookaheadDays); err != nil {
		return PuzzleConfig{}, err
	}

	if pc.PoolMaxTotal < pc.PoolTarget {
		return PuzzleConfig{}, fmt.Errorf(
			"HEARTHSIDE_PUZZLE_POOL_MAX_TOTAL (%d) must be >= HEARTHSIDE_PUZZLE_POOL_TARGET (%d)",
			pc.PoolMaxTotal, pc.PoolTarget,
		)
	}
	return pc, nil
}

func parseBoundedInt(lookup LookupFunc, key string, minVal, maxVal int, dst *int) error {
	raw, ok := lookupNonEmpty(lookup, key)
	if !ok {
		return nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fmt.Errorf("invalid %s %q: %w", key, raw, err)
	}
	if n < minVal || n > maxVal {
		return fmt.Errorf("%s (%d) must be between %d and %d", key, n, minVal, maxVal)
	}
	*dst = n
	return nil
}
