// Package auth implements password hashing, tokens, session management, OIDC, and household auth persistence.
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Password policy and Argon2id PHC parameter defaults.
const (
	MinPasswordLength = 10
	MaxPasswordLength = 1024

	argon2Version   = argon2.Version
	argon2MemoryKiB = 19456
	argon2Time      = 2
	argon2Threads   = 1
	argon2SaltLen   = 16
	argon2KeyLen    = 32
)

var dummyPasswordPHCHash string

func init() {
	salt := make([]byte, argon2SaltLen)
	key := argon2.IDKey([]byte("hearthside-dummy-timing-guard"), salt, argon2Time, argon2MemoryKiB, argon2Threads, argon2KeyLen)
	dummyPasswordPHCHash = formatArgon2PHC(argon2Time, argon2MemoryKiB, argon2Threads, salt, key)
}

// ValidatePassword checks minimum and maximum password bounds before hashing.
func ValidatePassword(password string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return fmt.Errorf("%w: password must be at least %d characters", ErrInvalidInput, MinPasswordLength)
	}
	if len(password) > MaxPasswordLength {
		return fmt.Errorf("%w: password exceeds maximum length", ErrInvalidInput)
	}
	return nil
}

// HashPassword hashes password with Argon2id and encodes the result as a PHC string.
func HashPassword(password string) (string, error) {
	if err := ValidatePassword(password); err != nil {
		return "", err
	}

	salt := make([]byte, argon2SaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("generate password salt: %w", err)
	}

	key := argon2.IDKey([]byte(password), salt, argon2Time, argon2MemoryKiB, argon2Threads, argon2KeyLen)
	return formatArgon2PHC(argon2Time, argon2MemoryKiB, argon2Threads, salt, key), nil
}

// VerifyPassword compares password against an Argon2id PHC string in constant time.
func VerifyPassword(password, encodedHash string) (bool, error) {
	if encodedHash == "" || len(password) > MaxPasswordLength {
		return false, nil
	}

	t, m, p, salt, expectedKey, err := parseArgon2PHC(encodedHash)
	if err != nil {
		return false, err
	}

	derivedKey := argon2.IDKey([]byte(password), salt, t, m, p, uint32(len(expectedKey)))
	return subtle.ConstantTimeCompare(derivedKey, expectedKey) == 1, nil
}

// DummyVerifyPassword runs an Argon2id derivation to avoid email-enumeration timing leaks.
func DummyVerifyPassword(password string) {
	_, _ = VerifyPassword(password, dummyPasswordPHCHash)
}

func formatArgon2PHC(t, m uint32, p uint8, salt, key []byte) string {
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2Version,
		m,
		t,
		p,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	)
}

func parseArgon2PHC(encoded string) (t, m uint32, p uint8, salt, key []byte, err error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return 0, 0, 0, nil, nil, errors.New("unsupported password hash format")
	}

	if parts[2] != fmt.Sprintf("v=%d", argon2Version) {
		return 0, 0, 0, nil, nil, errors.New("unsupported argon2 version")
	}

	var memParsed, timeParsed, threadsParsed uint64
	for _, param := range strings.Split(parts[3], ",") {
		kv := strings.SplitN(param, "=", 2)
		if len(kv) != 2 {
			return 0, 0, 0, nil, nil, errors.New("malformed argon2 parameter")
		}
		val, convErr := strconv.ParseUint(kv[1], 10, 32)
		if convErr != nil {
			return 0, 0, 0, nil, nil, fmt.Errorf("invalid argon2 parameter %q: %w", kv[0], convErr)
		}
		switch kv[0] {
		case "m":
			memParsed = val
		case "t":
			timeParsed = val
		case "p":
			threadsParsed = val
		default:
			return 0, 0, 0, nil, nil, fmt.Errorf("unknown argon2 parameter %q", kv[0])
		}
	}

	if memParsed == 0 || timeParsed == 0 || threadsParsed == 0 || threadsParsed > 255 {
		return 0, 0, 0, nil, nil, errors.New("invalid argon2 cost parameters")
	}

	salt, err = base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil || len(salt) == 0 {
		return 0, 0, 0, nil, nil, errors.New("invalid argon2 salt")
	}
	key, err = base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) == 0 {
		return 0, 0, 0, nil, nil, errors.New("invalid argon2 hash")
	}

	return uint32(timeParsed), uint32(memParsed), uint8(threadsParsed), salt, key, nil
}
