package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// Session, cookie, invite, and OIDC flow lifetime constants.
const (
	SessionCookieName     = "hearthside_session"
	SessionTTL            = 30 * 24 * time.Hour
	OIDCFlowTTL           = 10 * time.Minute
	DefaultInviteTTLHours = 168
	MaxInviteTTLHours     = 720

	randomTokenBytes = 32
	utcMillisLayout  = "2006-01-02T15:04:05.000Z"
)

// NewID returns a new random UUIDv4 string identifier.
func NewID() string {
	return uuid.NewString()
}

// GenerateToken generates a 32-byte cryptographically random base64url token.
func GenerateToken() (string, error) {
	buf := make([]byte, randomTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random token bytes: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

// HashToken returns the lowercase hex SHA-256 digest of a raw secret token.
func HashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// ConstantTimeEqualSecret compares two secret strings without leaking length or prefix timing.
func ConstantTimeEqualSecret(a, b string) bool {
	sumA := sha256.Sum256([]byte(a))
	sumB := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(sumA[:], sumB[:]) == 1
}

// SetSessionCookie writes the SameSite=Lax HttpOnly session cookie to w.
func SetSessionCookie(w http.ResponseWriter, rawToken string, secure bool, expiresAt time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    rawToken,
		Path:     "/",
		Expires:  expiresAt.UTC(),
		MaxAge:   int(SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// ClearSessionCookie instructs the client to delete the session cookie.
func ClearSessionCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

// FormatTime formats a timestamp as UTC ISO-8601 with millisecond precision.
func FormatTime(t time.Time) string {
	return t.UTC().Format(utcMillisLayout)
}

// ParseTime parses a UTC timestamp formatted by SQLite or FormatTime.
func ParseTime(raw string) (time.Time, error) {
	return time.Parse(time.RFC3339Nano, raw)
}
