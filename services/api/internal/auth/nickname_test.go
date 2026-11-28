package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestValidateNickname(t *testing.T) {
	validCases := []struct {
		raw  string
		want string
	}{
		{raw: "Alex", want: "Alex"},
		{raw: "  Mia   O'Connor  ", want: "Mia O'Connor"},
		{raw: "Jean-Luc 7", want: "Jean-Luc 7"},
		{raw: "Zoë-May", want: "Zoë-May"},
		{raw: "123456789012345678901234", want: "123456789012345678901234"},
	}

	for _, tc := range validCases {
		got, err := ValidateNickname(tc.raw)
		if err != nil {
			t.Fatalf("ValidateNickname(%q) returned unexpected error: %v", tc.raw, err)
		}
		if got != tc.want {
			t.Fatalf("ValidateNickname(%q) = %q, want %q", tc.raw, got, tc.want)
		}
	}

	invalidCases := []string{
		"",
		"   ",
		"1234567890123456789012345",
		"https://example.com",
		"http://evil.net",
		"www.puzzle.org",
		"visit foo.com",
		"<script>alert(1)</script>",
		"Alex<B>",
		"Bad\nName",
		"Tab\tName",
		"Null\x00Byte",
		"Name@home",
		"Player!One",
	}

	for _, raw := range invalidCases {
		if got, err := ValidateNickname(raw); !errors.Is(err, ErrInvalidNickname) {
			t.Fatalf("ValidateNickname(%q) = (%q, %v), want ErrInvalidNickname", raw, got, err)
		}
	}
}

func TestProfileFriendsVisibleDefaultsAndToggle(t *testing.T) {
	now := time.Date(2026, 11, 28, 12, 0, 0, 0, time.UTC)
	store := openTestStore(t, &now)
	ctx := context.Background()

	boot, err := store.BootstrapWithPassword(ctx, BootstrapInput{
		HouseholdName: "Maple Home",
		DisplayName:   "Parent",
		Email:         "parent@example.com",
		Password:      "maple-password-123",
	}, "")
	if err != nil {
		t.Fatalf("BootstrapWithPassword failed: %v", err)
	}
	if len(boot.Profiles) != 1 {
		t.Fatalf("len(boot.Profiles) = %d, want 1", len(boot.Profiles))
	}
	adult := boot.Profiles[0]
	if adult.IsChild || !adult.FriendsVisible {
		t.Fatalf("adult profile defaults = (isChild=%v, friendsVisible=%v), want (false, true)", adult.IsChild, adult.FriendsVisible)
	}

	child, err := store.CreateChildProfile(ctx, boot.Household.ID, CreateProfileInput{
		Name: "  Leo-Jr  ",
	})
	if err != nil {
		t.Fatalf("CreateChildProfile failed: %v", err)
	}
	if child.Name != "Leo-Jr" {
		t.Fatalf("child.Name = %q, want Leo-Jr", child.Name)
	}
	if !child.IsChild || child.FriendsVisible {
		t.Fatalf("child profile defaults = (isChild=%v, friendsVisible=%v), want (true, false)", child.IsChild, child.FriendsVisible)
	}

	sc, err := store.AuthenticateSession(ctx, boot.RawSessionToken)
	if err != nil {
		t.Fatalf("AuthenticateSession failed: %v", err)
	}

	show := true
	updatedChild, err := store.UpdateProfile(ctx, *sc, child.ID, UpdateProfileInput{
		FriendsVisible: &show,
	})
	if err != nil {
		t.Fatalf("UpdateProfile(child friendsVisible=true) failed: %v", err)
	}
	if !updatedChild.FriendsVisible {
		t.Fatalf("expected updated child FriendsVisible=true")
	}

	hide := false
	updatedAdult, err := store.UpdateProfile(ctx, *sc, adult.ID, UpdateProfileInput{
		FriendsVisible: &hide,
	})
	if err != nil {
		t.Fatalf("UpdateProfile(adult friendsVisible=false) failed: %v", err)
	}
	if updatedAdult.FriendsVisible {
		t.Fatalf("expected updated adult FriendsVisible=false")
	}
}
