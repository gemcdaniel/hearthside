package auth

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

func openTestStore(t *testing.T, clock *time.Time) *Store {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("db.Open failed: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("db.Migrate failed: %v", err)
	}

	nowFn := time.Now
	if clock != nil {
		nowFn = func() time.Time { return *clock }
	}
	return NewStore(database, nowFn)
}

func TestPasswordHashAndVerify(t *testing.T) {
	if err := ValidatePassword("short"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for short password, got %v", err)
	}

	encoded, err := HashPassword("correct-horse-battery-staple")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}
	if !strings.HasPrefix(encoded, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Fatalf("unexpected PHC string format: %q", encoded)
	}

	ok, err := VerifyPassword("correct-horse-battery-staple", encoded)
	if err != nil || !ok {
		t.Fatalf("VerifyPassword valid failed: ok=%v err=%v", ok, err)
	}

	bad, err := VerifyPassword("wrong-password-1234", encoded)
	if err != nil || bad {
		t.Fatalf("VerifyPassword invalid returned ok=%v err=%v", bad, err)
	}

	// Dummy verify should not panic.
	DummyVerifyPassword("does-not-exist")
}

func TestTokensAndHashing(t *testing.T) {
	tokA, err := GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}
	tokB, err := GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}
	if tokA == tokB || len(tokA) < 40 {
		t.Fatalf("expected distinct long random tokens, got %q and %q", tokA, tokB)
	}
	if HashToken(tokA) == tokA || len(HashToken(tokA)) != 64 {
		t.Fatalf("expected 64-char sha256 hex digest")
	}
	if !ConstantTimeEqualSecret("secret-1", "secret-1") || ConstantTimeEqualSecret("secret-1", "secret-2") {
		t.Fatalf("ConstantTimeEqualSecret behaved unexpectedly")
	}
}

func TestStoreSessionAndInviteExpiry(t *testing.T) {
	now := time.Date(2026, 11, 27, 15, 0, 0, 0, time.UTC)
	store := openTestStore(t, &now)
	ctx := context.Background()

	res, err := store.BootstrapWithPassword(ctx, BootstrapInput{
		HouseholdName: "Test Home",
		DisplayName:   "Parent",
		Email:         "Parent@Example.COM",
		Password:      "super-secure-pw",
	}, "")
	if err != nil {
		t.Fatalf("BootstrapWithPassword failed: %v", err)
	}

	sc, err := store.AuthenticateSession(ctx, res.RawSessionToken)
	if err != nil {
		t.Fatalf("AuthenticateSession failed: %v", err)
	}
	if sc.User.Email != "parent@example.com" {
		t.Fatalf("normalized email = %q, want parent@example.com", sc.User.Email)
	}

	inv, rawInvite, err := store.CreateInvite(ctx, *sc, CreateInviteInput{
		Mode:           InviteModeJoinHousehold,
		ExpiresInHours: 1,
	})
	if err != nil {
		t.Fatalf("CreateInvite failed: %v", err)
	}
	if inv.Status != "active" {
		t.Fatalf("invite status = %q, want active", inv.Status)
	}

	// Advance clock by 2 hours: invite should expire, session still valid.
	now = now.Add(2 * time.Hour)
	if _, err := store.RegisterWithInvitePassword(ctx, RegisterInviteInput{
		InviteToken: rawInvite,
		DisplayName: "Partner",
		Email:       "partner@example.com",
		Password:    "another-secure-pw",
	}); !errors.Is(err, ErrInvalidInvite) {
		t.Fatalf("expected ErrInvalidInvite for expired invite, got %v", err)
	}

	listed, err := store.ListInvites(ctx, sc.Household.ID)
	if err != nil || len(listed) != 1 || listed[0].Status != "expired" {
		t.Fatalf("expected expired status in ListInvites, got %+v err=%v", listed, err)
	}

	// Advance past 30-day session TTL.
	now = now.Add(SessionTTL)
	if _, err := store.AuthenticateSession(ctx, res.RawSessionToken); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for expired session, got %v", err)
	}
}
