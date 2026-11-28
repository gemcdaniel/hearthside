package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"
)

// Domain sentinel errors returned by Store operations.
var (
	ErrNotFound                 = errors.New("not found")
	ErrAlreadyBootstrapped      = errors.New("household already bootstrapped")
	ErrInvalidBootstrapToken    = errors.New("invalid bootstrap token")
	ErrInvalidCredentials       = errors.New("invalid email or password")
	ErrInvalidInvite            = errors.New("invalid, expired, or used invite")
	ErrEmailExists              = errors.New("email already registered")
	ErrForbidden                = errors.New("forbidden")
	ErrCannotDeleteAdultProfile = errors.New("cannot delete adult or owner profile")
	ErrOIDCDisabled             = errors.New("oidc provider is disabled")
	ErrOIDCEmailNotVerified     = errors.New("oidc email is not verified")
	ErrInvalidInput             = errors.New("invalid input")
	ErrConflict                 = errors.New("conflict")
)

// UserRole values stored in the users table.
const (
	RoleOwner = "owner"
	RoleAdult = "adult"
)

// InviteMode values stored in the invites table.
const (
	InviteModeJoinHousehold = "join_household"
	InviteModeNewHousehold  = "new_household"
)

const (
	defaultAvatarID    = "hearth"
	defaultAccentColor = "terracotta"
	maxNameLength      = 80
	maxMetaLength      = 40
)

// Household represents a family household container.
type Household struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// User represents an adult or owner account belonging to a household.
type User struct {
	ID          string `json:"id"`
	HouseholdID string `json:"householdId"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	CreatedAt   string `json:"createdAt"`
}

// Profile represents a household player profile; UserID is nil for child profiles.
type Profile struct {
	ID             string  `json:"id"`
	HouseholdID    string  `json:"householdId"`
	UserID         *string `json:"userId"`
	Name           string  `json:"name"`
	AvatarID       string  `json:"avatarId"`
	AccentColor    string  `json:"accentColor"`
	IsChild        bool    `json:"isChild"`
	FriendsVisible bool    `json:"friendsVisible"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

// Invite represents invite metadata returned to household members (never raw tokens).
type Invite struct {
	ID              string  `json:"id"`
	HouseholdID     string  `json:"householdId"`
	CreatedByUserID string  `json:"createdByUserId"`
	Mode            string  `json:"mode"`
	EmailHint       string  `json:"emailHint,omitempty"`
	Status          string  `json:"status"`
	ExpiresAt       string  `json:"expiresAt"`
	UsedAt          *string `json:"usedAt,omitempty"`
	RevokedAt       *string `json:"revokedAt,omitempty"`
	CreatedAt       string  `json:"createdAt"`
}

// SessionContext carries the authenticated user and household resolved from a session cookie.
type SessionContext struct {
	SessionID string
	User      User
	Household Household
}

// Result holds the authenticated state and issued session metadata after auth or /me.
type Result struct {
	User             User      `json:"user"`
	Household        Household `json:"household"`
	Profiles         []Profile `json:"profiles"`
	RawSessionToken  string    `json:"-"`
	SessionExpiresAt time.Time `json:"-"`
}

// BootstrapInput supplies fields required to create the founding household and owner account.
type BootstrapInput struct {
	HouseholdName  string
	DisplayName    string
	Email          string
	Password       string
	AvatarID       string
	AccentColor    string
	BootstrapToken string
}

// RegisterInviteInput supplies fields required to redeem a single-use invite via password.
type RegisterInviteInput struct {
	InviteToken   string
	HouseholdName string
	DisplayName   string
	Email         string
	Password      string
	AvatarID      string
	AccentColor   string
}

// CreateInviteInput supplies parameters for creating a single-use household invite.
type CreateInviteInput struct {
	Mode           string
	EmailHint      string
	ExpiresInHours int
}

// CreateProfileInput supplies attributes for creating a child profile.
type CreateProfileInput struct {
	Name        string
	AvatarID    string
	AccentColor string
}

// UpdateProfileInput supplies mutable attributes when updating a household profile.
type UpdateProfileInput struct {
	Name           *string
	AvatarID       *string
	AccentColor    *string
	FriendsVisible *bool
}

// OIDCFlow represents a single-use server-side OIDC PKCE state entry.
type OIDCFlow struct {
	StateHash       string
	Nonce           string
	CodeVerifier    string
	InviteTokenHash string
	Bootstrap       bool
	ExpiresAt       time.Time
}

// Store persists and enforces auth, invite, session, and household profile invariants in SQLite.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// NewStore returns a Store using database and an optional clock (defaults to time.Now).
func NewStore(database *sql.DB, now func() time.Time) *Store {
	if now == nil {
		now = time.Now
	}
	return &Store{
		db:  database,
		now: now,
	}
}

// BootstrapRequired reports whether zero users currently exist in the database.
func (s *Store) BootstrapRequired(ctx context.Context) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return false, fmt.Errorf("count users: %w", err)
	}
	return count == 0, nil
}

// BootstrapWithPassword creates the initial household, owner user, adult profile, and session.
func (s *Store) BootstrapWithPassword(ctx context.Context, input BootstrapInput, expectedBootstrapToken string) (*Result, error) {
	householdName, err := validateRequiredName("householdName", input.HouseholdName)
	if err != nil {
		return nil, err
	}
	displayName, err := ValidateNickname(input.DisplayName)
	if err != nil {
		return nil, err
	}
	email, err := normalizeAndValidateEmail(input.Email)
	if err != nil {
		return nil, err
	}
	if expectedBootstrapToken != "" && !ConstantTimeEqualSecret(input.BootstrapToken, expectedBootstrapToken) {
		return nil, ErrInvalidBootstrapToken
	}

	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return nil, err
	}
	avatarID, accentColor := normalizeVisuals(input.AvatarID, input.AccentColor)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin bootstrap tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return nil, fmt.Errorf("count users in tx: %w", err)
	}
	if count > 0 {
		return nil, ErrAlreadyBootstrapped
	}

	nowStr := FormatTime(s.now())
	household := Household{
		ID:        NewID(),
		Name:      householdName,
		CreatedAt: nowStr,
	}
	user := User{
		ID:          NewID(),
		HouseholdID: household.ID,
		Email:       email,
		DisplayName: displayName,
		Role:        RoleOwner,
		CreatedAt:   nowStr,
	}

	result, err := s.createHouseholdAndUserTx(ctx, tx, household, user, &passwordHash, avatarID, accentColor)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit bootstrap tx: %w", err)
	}
	return result, nil
}

// RegisterWithInvitePassword redeems a single-use invite token and creates an adult/owner account.
func (s *Store) RegisterWithInvitePassword(ctx context.Context, input RegisterInviteInput) (*Result, error) {
	rawToken := strings.TrimSpace(input.InviteToken)
	if rawToken == "" {
		return nil, ErrInvalidInvite
	}
	displayName, err := ValidateNickname(input.DisplayName)
	if err != nil {
		return nil, err
	}
	email, err := normalizeAndValidateEmail(input.Email)
	if err != nil {
		return nil, err
	}
	passwordHash, err := HashPassword(input.Password)
	if err != nil {
		return nil, err
	}
	avatarID, accentColor := normalizeVisuals(input.AvatarID, input.AccentColor)
	tokenHash := HashToken(rawToken)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin register tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	result, err := s.registerViaInviteTx(ctx, tx, tokenHash, input.HouseholdName, displayName, email, &passwordHash, avatarID, accentColor)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit register tx: %w", err)
	}
	return result, nil
}

// LoginWithPassword verifies email/password credentials and issues a new session.
func (s *Store) LoginWithPassword(ctx context.Context, emailRaw, password string) (*Result, error) {
	email, err := normalizeAndValidateEmail(emailRaw)
	if err != nil {
		DummyVerifyPassword(password)
		return nil, ErrInvalidCredentials
	}
	if password == "" {
		DummyVerifyPassword("")
		return nil, ErrInvalidCredentials
	}

	var user User
	var passwordHash sql.NullString
	var household Household

	err = s.db.QueryRowContext(ctx, `
		SELECT u.id, u.household_id, u.email, u.password_hash, u.display_name, u.role, u.created_at,
		       h.id, h.name, h.created_at
		FROM users u
		JOIN households h ON h.id = u.household_id
		WHERE u.email = ?
	`, email).Scan(
		&user.ID, &user.HouseholdID, &user.Email, &passwordHash, &user.DisplayName, &user.Role, &user.CreatedAt,
		&household.ID, &household.Name, &household.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			DummyVerifyPassword(password)
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("lookup login user: %w", err)
	}

	if !passwordHash.Valid || passwordHash.String == "" {
		DummyVerifyPassword(password)
		return nil, ErrInvalidCredentials
	}

	ok, verifyErr := VerifyPassword(password, passwordHash.String)
	if verifyErr != nil || !ok {
		return nil, ErrInvalidCredentials
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin login tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	rawSession, expiresAt, err := s.createSessionTx(ctx, tx, user.ID)
	if err != nil {
		return nil, err
	}
	profiles, err := listProfilesTx(ctx, tx, household.ID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit login tx: %w", err)
	}

	return &Result{
		User:             user,
		Household:        household,
		Profiles:         profiles,
		RawSessionToken:  rawSession,
		SessionExpiresAt: expiresAt,
	}, nil
}

// AuthenticateSession validates a raw session token cookie and updates last_seen_at.
func (s *Store) AuthenticateSession(ctx context.Context, rawToken string) (*SessionContext, error) {
	if strings.TrimSpace(rawToken) == "" {
		return nil, ErrInvalidCredentials
	}
	tokenHash := HashToken(rawToken)
	nowTime := s.now()
	nowStr := FormatTime(nowTime)

	var sc SessionContext
	var expiresRaw string
	var revokedRaw sql.NullString

	err := s.db.QueryRowContext(ctx, `
		SELECT s.id, s.expires_at, s.revoked_at,
		       u.id, u.household_id, u.email, u.display_name, u.role, u.created_at,
		       h.id, h.name, h.created_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN households h ON h.id = u.household_id
		WHERE s.token_hash = ?
	`, tokenHash).Scan(
		&sc.SessionID, &expiresRaw, &revokedRaw,
		&sc.User.ID, &sc.User.HouseholdID, &sc.User.Email, &sc.User.DisplayName, &sc.User.Role, &sc.User.CreatedAt,
		&sc.Household.ID, &sc.Household.Name, &sc.Household.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("query session: %w", err)
	}

	if revokedRaw.Valid {
		return nil, ErrInvalidCredentials
	}

	expiresAt, err := ParseTime(expiresRaw)
	if err != nil || !nowTime.Before(expiresAt) {
		return nil, ErrInvalidCredentials
	}

	if _, err := s.db.ExecContext(ctx, `UPDATE sessions SET last_seen_at = ? WHERE id = ?`, nowStr, sc.SessionID); err != nil {
		return nil, fmt.Errorf("update session last_seen_at: %w", err)
	}

	return &sc, nil
}

// RevokeSession marks an active session revoked so its cookie is rejected immediately.
func (s *Store) RevokeSession(ctx context.Context, rawToken string) error {
	if strings.TrimSpace(rawToken) == "" {
		return nil
	}
	nowStr := FormatTime(s.now())
	if _, err := s.db.ExecContext(ctx, `
		UPDATE sessions SET revoked_at = ?
		WHERE token_hash = ? AND revoked_at IS NULL
	`, nowStr, HashToken(rawToken)); err != nil {
		return fmt.Errorf("revoke session: %w", err)
	}
	return nil
}

// GetMe loads the current user, household, and household profiles.
func (s *Store) GetMe(ctx context.Context, userID string) (*Result, error) {
	var user User
	var household Household

	err := s.db.QueryRowContext(ctx, `
		SELECT u.id, u.household_id, u.email, u.display_name, u.role, u.created_at,
		       h.id, h.name, h.created_at
		FROM users u
		JOIN households h ON h.id = u.household_id
		WHERE u.id = ?
	`, userID).Scan(
		&user.ID, &user.HouseholdID, &user.Email, &user.DisplayName, &user.Role, &user.CreatedAt,
		&household.ID, &household.Name, &household.CreatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("query user me: %w", err)
	}

	profiles, err := s.ListProfiles(ctx, household.ID)
	if err != nil {
		return nil, err
	}

	return &Result{
		User:      user,
		Household: household,
		Profiles:  profiles,
	}, nil
}

// CreateInvite creates a single-use invite scoped to actor's household and returns the raw token once.
func (s *Store) CreateInvite(ctx context.Context, actor SessionContext, input CreateInviteInput) (*Invite, string, error) {
	mode := strings.TrimSpace(input.Mode)
	if mode == "" {
		mode = InviteModeJoinHousehold
	}
	if mode != InviteModeJoinHousehold && mode != InviteModeNewHousehold {
		return nil, "", fmt.Errorf("%w: invalid invite mode", ErrInvalidInput)
	}

	emailHint := strings.TrimSpace(strings.ToLower(input.EmailHint))
	if emailHint != "" {
		normalized, err := normalizeAndValidateEmail(emailHint)
		if err != nil {
			return nil, "", err
		}
		emailHint = normalized
	}

	ttlHours := input.ExpiresInHours
	if ttlHours == 0 {
		ttlHours = DefaultInviteTTLHours
	}
	if ttlHours < 1 || ttlHours > MaxInviteTTLHours {
		return nil, "", fmt.Errorf("%w: expiresInHours must be between 1 and %d", ErrInvalidInput, MaxInviteTTLHours)
	}

	rawToken, err := GenerateToken()
	if err != nil {
		return nil, "", err
	}

	nowTime := s.now()
	nowStr := FormatTime(nowTime)
	expiresStr := FormatTime(nowTime.Add(time.Duration(ttlHours) * time.Hour))

	invite := Invite{
		ID:              NewID(),
		HouseholdID:     actor.Household.ID,
		CreatedByUserID: actor.User.ID,
		Mode:            mode,
		EmailHint:       emailHint,
		Status:          "active",
		ExpiresAt:       expiresStr,
		CreatedAt:       nowStr,
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO invites (id, household_id, created_by_user_id, token_hash, mode, email_hint, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, invite.ID, invite.HouseholdID, invite.CreatedByUserID, HashToken(rawToken), invite.Mode, invite.EmailHint, invite.ExpiresAt, invite.CreatedAt); err != nil {
		return nil, "", fmt.Errorf("insert invite: %w", err)
	}

	return &invite, rawToken, nil
}

// ListInvites lists invites created for householdID with computed lifecycle status (no secrets).
func (s *Store) ListInvites(ctx context.Context, householdID string) ([]Invite, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, household_id, created_by_user_id, mode, email_hint, expires_at, used_at, revoked_at, created_at
		FROM invites
		WHERE household_id = ?
		ORDER BY created_at DESC, id DESC
	`, householdID)
	if err != nil {
		return nil, fmt.Errorf("list invites: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	nowTime := s.now()
	invites := make([]Invite, 0)
	for rows.Next() {
		var inv Invite
		var usedAt, revokedAt sql.NullString
		if err := rows.Scan(
			&inv.ID, &inv.HouseholdID, &inv.CreatedByUserID, &inv.Mode,
			&inv.EmailHint, &inv.ExpiresAt, &usedAt, &revokedAt, &inv.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan invite: %w", err)
		}
		if usedAt.Valid {
			inv.UsedAt = &usedAt.String
		}
		if revokedAt.Valid {
			inv.RevokedAt = &revokedAt.String
		}
		inv.Status = computeInviteStatus(nowTime, inv.ExpiresAt, inv.UsedAt, inv.RevokedAt)
		invites = append(invites, inv)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate invites: %w", err)
	}
	return invites, nil
}

// RevokeInvite revokes an unused invite belonging to actor's household.
func (s *Store) RevokeInvite(ctx context.Context, actor SessionContext, inviteID string) error {
	var usedAt, revokedAt sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT used_at, revoked_at
		FROM invites
		WHERE id = ? AND household_id = ?
	`, inviteID, actor.Household.ID).Scan(&usedAt, &revokedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("lookup invite to revoke: %w", err)
	}
	if usedAt.Valid || revokedAt.Valid {
		return ErrConflict
	}

	nowStr := FormatTime(s.now())
	res, err := s.db.ExecContext(ctx, `
		UPDATE invites SET revoked_at = ?
		WHERE id = ? AND household_id = ? AND used_at IS NULL AND revoked_at IS NULL
	`, nowStr, inviteID, actor.Household.ID)
	if err != nil {
		return fmt.Errorf("revoke invite: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check revoked rows: %w", err)
	}
	if affected == 0 {
		return ErrConflict
	}
	return nil
}

// ListProfiles returns all profiles belonging to householdID.
func (s *Store) ListProfiles(ctx context.Context, householdID string) ([]Profile, error) {
	return listProfilesQuery(ctx, s.db, householdID)
}

// CreateChildProfile creates a login-free child profile inside householdID.
func (s *Store) CreateChildProfile(ctx context.Context, householdID string, input CreateProfileInput) (*Profile, error) {
	name, err := ValidateNickname(input.Name)
	if err != nil {
		return nil, err
	}
	avatarID, accentColor := normalizeVisuals(input.AvatarID, input.AccentColor)

	nowStr := FormatTime(s.now())
	profile := Profile{
		ID:             NewID(),
		HouseholdID:    householdID,
		UserID:         nil,
		Name:           name,
		AvatarID:       avatarID,
		AccentColor:    accentColor,
		IsChild:        true,
		FriendsVisible: false,
		CreatedAt:      nowStr,
		UpdatedAt:      nowStr,
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO profiles (id, household_id, user_id, name, avatar_id, accent_color, is_child, friends_visible, created_at, updated_at)
		VALUES (?, ?, NULL, ?, ?, ?, 1, 0, ?, ?)
	`, profile.ID, profile.HouseholdID, profile.Name, profile.AvatarID, profile.AccentColor, profile.CreatedAt, profile.UpdatedAt); err != nil {
		return nil, fmt.Errorf("insert child profile: %w", err)
	}

	return &profile, nil
}

// UpdateProfile updates name/avatar/accentColor/friendsVisible for a child profile in actor's household or actor's own profile.
func (s *Store) UpdateProfile(ctx context.Context, actor SessionContext, profileID string, input UpdateProfileInput) (*Profile, error) {
	existing, err := scanSingleProfile(ctx, s.db, `
		SELECT id, household_id, user_id, name, avatar_id, accent_color, is_child, friends_visible, created_at, updated_at
		FROM profiles
		WHERE id = ? AND household_id = ?
	`, profileID, actor.Household.ID)
	if err != nil {
		return nil, err
	}

	isSelf := existing.UserID != nil && *existing.UserID == actor.User.ID
	if !existing.IsChild && !isSelf {
		return nil, ErrForbidden
	}

	name := existing.Name
	avatarID := existing.AvatarID
	accentColor := existing.AccentColor
	friendsVisible := existing.FriendsVisible

	if input.Name != nil {
		validated, valErr := ValidateNickname(*input.Name)
		if valErr != nil {
			return nil, valErr
		}
		name = validated
	}
	if input.AvatarID != nil {
		trimmed := strings.TrimSpace(*input.AvatarID)
		if trimmed == "" || utf8.RuneCountInString(trimmed) > maxMetaLength {
			return nil, fmt.Errorf("%w: invalid avatarId", ErrInvalidInput)
		}
		avatarID = trimmed
	}
	if input.AccentColor != nil {
		trimmed := strings.TrimSpace(*input.AccentColor)
		if trimmed == "" || utf8.RuneCountInString(trimmed) > maxMetaLength {
			return nil, fmt.Errorf("%w: invalid accentColor", ErrInvalidInput)
		}
		accentColor = trimmed
	}
	if input.FriendsVisible != nil {
		friendsVisible = *input.FriendsVisible
	}

	friendsVisibleInt := 0
	if friendsVisible {
		friendsVisibleInt = 1
	}

	updatedAt := FormatTime(s.now())
	if _, err := s.db.ExecContext(ctx, `
		UPDATE profiles
		SET name = ?, avatar_id = ?, accent_color = ?, friends_visible = ?, updated_at = ?
		WHERE id = ? AND household_id = ?
	`, name, avatarID, accentColor, friendsVisibleInt, updatedAt, profileID, actor.Household.ID); err != nil {
		return nil, fmt.Errorf("update profile: %w", err)
	}

	existing.Name = name
	existing.AvatarID = avatarID
	existing.AccentColor = accentColor
	existing.FriendsVisible = friendsVisible
	existing.UpdatedAt = updatedAt
	return existing, nil
}

// DeleteChildProfile removes a child profile belonging to actor's household (rejecting adult/owner profiles).
func (s *Store) DeleteChildProfile(ctx context.Context, actor SessionContext, profileID string) error {
	existing, err := scanSingleProfile(ctx, s.db, `
		SELECT id, household_id, user_id, name, avatar_id, accent_color, is_child, friends_visible, created_at, updated_at
		FROM profiles
		WHERE id = ? AND household_id = ?
	`, profileID, actor.Household.ID)
	if err != nil {
		return err
	}

	if !existing.IsChild {
		return ErrCannotDeleteAdultProfile
	}

	res, err := s.db.ExecContext(ctx, `
		DELETE FROM profiles
		WHERE id = ? AND household_id = ? AND is_child = 1
	`, profileID, actor.Household.ID)
	if err != nil {
		return fmt.Errorf("delete child profile: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("check deleted profile rows: %w", err)
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

// SaveOIDCFlow persists a single-use OIDC PKCE state entry before redirecting to the IdP.
func (s *Store) SaveOIDCFlow(ctx context.Context, flow OIDCFlow) error {
	nowStr := FormatTime(s.now())
	bootstrapInt := 0
	if flow.Bootstrap {
		bootstrapInt = 1
	}

	var inviteHash any
	if flow.InviteTokenHash != "" {
		inviteHash = flow.InviteTokenHash
	}

	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO oidc_auth_flows (state_hash, nonce, code_verifier, invite_token_hash, bootstrap, expires_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, flow.StateHash, flow.Nonce, flow.CodeVerifier, inviteHash, bootstrapInt, FormatTime(flow.ExpiresAt), nowStr); err != nil {
		return fmt.Errorf("insert oidc flow: %w", err)
	}
	return nil
}

// ConsumeOIDCFlow atomically deletes and returns an active OIDC flow for state, rejecting replays and expiry.
func (s *Store) ConsumeOIDCFlow(ctx context.Context, rawState string) (*OIDCFlow, error) {
	if strings.TrimSpace(rawState) == "" {
		return nil, ErrInvalidCredentials
	}
	stateHash := HashToken(rawState)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin consume oidc flow tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var flow OIDCFlow
	var inviteHash sql.NullString
	var bootstrapInt int
	var expiresRaw string

	err = tx.QueryRowContext(ctx, `
		SELECT state_hash, nonce, code_verifier, invite_token_hash, bootstrap, expires_at
		FROM oidc_auth_flows
		WHERE state_hash = ?
	`, stateHash).Scan(&flow.StateHash, &flow.Nonce, &flow.CodeVerifier, &inviteHash, &bootstrapInt, &expiresRaw)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("lookup oidc flow: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DELETE FROM oidc_auth_flows WHERE state_hash = ?`, stateHash); err != nil {
		return nil, fmt.Errorf("delete oidc flow: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit consume oidc flow tx: %w", err)
	}

	if inviteHash.Valid {
		flow.InviteTokenHash = inviteHash.String
	}
	flow.Bootstrap = bootstrapInt == 1

	expiresAt, err := ParseTime(expiresRaw)
	if err != nil || !s.now().Before(expiresAt) {
		return nil, ErrInvalidCredentials
	}

	return &flow, nil
}

// CompleteOIDCAuth completes sign-in, bootstrap, invite signup, or verified-email linking inside a transaction.
func (s *Store) CompleteOIDCAuth(ctx context.Context, flow OIDCFlow, claims OIDCClaims) (*Result, error) {
	if strings.TrimSpace(claims.Issuer) == "" || strings.TrimSpace(claims.Subject) == "" {
		return nil, fmt.Errorf("%w: missing oidc subject or issuer", ErrInvalidInput)
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin oidc complete tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if flow.Bootstrap {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
			return nil, fmt.Errorf("count users in oidc bootstrap: %w", err)
		}
		if count > 0 {
			return nil, ErrAlreadyBootstrapped
		}
	}

	var existingUser User
	var existingHousehold Household
	err = tx.QueryRowContext(ctx, `
		SELECT u.id, u.household_id, u.email, u.display_name, u.role, u.created_at,
		       h.id, h.name, h.created_at
		FROM user_identities ui
		JOIN users u ON u.id = ui.user_id
		JOIN households h ON h.id = u.household_id
		WHERE ui.issuer = ? AND ui.subject = ?
	`, claims.Issuer, claims.Subject).Scan(
		&existingUser.ID, &existingUser.HouseholdID, &existingUser.Email, &existingUser.DisplayName, &existingUser.Role, &existingUser.CreatedAt,
		&existingHousehold.ID, &existingHousehold.Name, &existingHousehold.CreatedAt,
	)
	if err == nil {
		if flow.InviteTokenHash != "" {
			return nil, ErrConflict
		}
		rawSession, expiresAt, sessErr := s.createSessionTx(ctx, tx, existingUser.ID)
		if sessErr != nil {
			return nil, sessErr
		}
		profiles, profErr := listProfilesTx(ctx, tx, existingHousehold.ID)
		if profErr != nil {
			return nil, profErr
		}
		if err := tx.Commit(); err != nil {
			return nil, fmt.Errorf("commit oidc login tx: %w", err)
		}
		return &Result{
			User:             existingUser,
			Household:        existingHousehold,
			Profiles:         profiles,
			RawSessionToken:  rawSession,
			SessionExpiresAt: expiresAt,
		}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("lookup oidc identity: %w", err)
	}

	email, emailErr := normalizeAndValidateEmail(claims.Email)
	if emailErr != nil {
		return nil, emailErr
	}
	displayName, nameErr := ValidateNickname(claims.DisplayName)
	if nameErr != nil {
		displayName = "Household Member"
	}

	var result *Result
	switch {
	case flow.Bootstrap:
		nowStr := FormatTime(s.now())
		household := Household{
			ID:        NewID(),
			Name:      defaultHouseholdName(displayName),
			CreatedAt: nowStr,
		}
		user := User{
			ID:          NewID(),
			HouseholdID: household.ID,
			Email:       email,
			DisplayName: displayName,
			Role:        RoleOwner,
			CreatedAt:   nowStr,
		}
		result, err = s.createHouseholdAndUserTx(ctx, tx, household, user, nil, defaultAvatarID, defaultAccentColor)
		if err != nil {
			return nil, err
		}
		if err := insertIdentityTx(ctx, tx, user.ID, claims.Issuer, claims.Subject, email, nowStr); err != nil {
			return nil, err
		}

	case flow.InviteTokenHash != "":
		result, err = s.registerViaInviteTx(ctx, tx, flow.InviteTokenHash, "", displayName, email, nil, defaultAvatarID, defaultAccentColor)
		if err != nil {
			return nil, err
		}
		if err := insertIdentityTx(ctx, tx, result.User.ID, claims.Issuer, claims.Subject, email, result.User.CreatedAt); err != nil {
			return nil, err
		}

	default:
		// Invite-only policy: unlinked OIDC sign-in only matches an existing adult email when verified.
		err = tx.QueryRowContext(ctx, `
			SELECT u.id, u.household_id, u.email, u.display_name, u.role, u.created_at,
			       h.id, h.name, h.created_at
			FROM users u
			JOIN households h ON h.id = u.household_id
			WHERE u.email = ?
		`, email).Scan(
			&existingUser.ID, &existingUser.HouseholdID, &existingUser.Email, &existingUser.DisplayName, &existingUser.Role, &existingUser.CreatedAt,
			&existingHousehold.ID, &existingHousehold.Name, &existingHousehold.CreatedAt,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, ErrInvalidInvite
			}
			return nil, fmt.Errorf("lookup user by oidc email: %w", err)
		}

		if !claims.EmailVerified {
			return nil, ErrOIDCEmailNotVerified
		}

		nowStr := FormatTime(s.now())
		if err := insertIdentityTx(ctx, tx, existingUser.ID, claims.Issuer, claims.Subject, email, nowStr); err != nil {
			return nil, err
		}

		rawSession, expiresAt, sessErr := s.createSessionTx(ctx, tx, existingUser.ID)
		if sessErr != nil {
			return nil, sessErr
		}
		profiles, profErr := listProfilesTx(ctx, tx, existingHousehold.ID)
		if profErr != nil {
			return nil, profErr
		}
		result = &Result{
			User:             existingUser,
			Household:        existingHousehold,
			Profiles:         profiles,
			RawSessionToken:  rawSession,
			SessionExpiresAt: expiresAt,
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit oidc complete tx: %w", err)
	}
	return result, nil
}

func (s *Store) createHouseholdAndUserTx(
	ctx context.Context,
	tx *sql.Tx,
	household Household,
	user User,
	passwordHash *string,
	avatarID, accentColor string,
) (*Result, error) {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO households (id, name, created_at)
		VALUES (?, ?, ?)
	`, household.ID, household.Name, household.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert household: %w", err)
	}

	if err := insertUserAndProfileTx(ctx, tx, user, passwordHash, avatarID, accentColor); err != nil {
		return nil, err
	}

	rawSession, expiresAt, err := s.createSessionTx(ctx, tx, user.ID)
	if err != nil {
		return nil, err
	}
	profiles, err := listProfilesTx(ctx, tx, household.ID)
	if err != nil {
		return nil, err
	}

	return &Result{
		User:             user,
		Household:        household,
		Profiles:         profiles,
		RawSessionToken:  rawSession,
		SessionExpiresAt: expiresAt,
	}, nil
}

func (s *Store) registerViaInviteTx(
	ctx context.Context,
	tx *sql.Tx,
	tokenHash, requestedHouseholdName, displayName, email string,
	passwordHash *string,
	avatarID, accentColor string,
) (*Result, error) {
	var inviteID, inviteHouseholdID, mode, expiresRaw string
	var usedAt, revokedAt sql.NullString

	err := tx.QueryRowContext(ctx, `
		SELECT id, household_id, mode, expires_at, used_at, revoked_at
		FROM invites
		WHERE token_hash = ?
	`, tokenHash).Scan(&inviteID, &inviteHouseholdID, &mode, &expiresRaw, &usedAt, &revokedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrInvalidInvite
		}
		return nil, fmt.Errorf("lookup invite: %w", err)
	}

	if usedAt.Valid || revokedAt.Valid {
		return nil, ErrInvalidInvite
	}
	expiresAt, err := ParseTime(expiresRaw)
	if err != nil || !s.now().Before(expiresAt) {
		return nil, ErrInvalidInvite
	}

	nowStr := FormatTime(s.now())
	var targetHousehold Household
	role := RoleAdult

	if mode == InviteModeNewHousehold {
		role = RoleOwner
		householdName := strings.TrimSpace(requestedHouseholdName)
		if householdName == "" {
			householdName = defaultHouseholdName(displayName)
		} else if utf8.RuneCountInString(householdName) > maxNameLength {
			return nil, fmt.Errorf("%w: householdName too long", ErrInvalidInput)
		}
		targetHousehold = Household{
			ID:        NewID(),
			Name:      householdName,
			CreatedAt: nowStr,
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO households (id, name, created_at)
			VALUES (?, ?, ?)
		`, targetHousehold.ID, targetHousehold.Name, targetHousehold.CreatedAt); err != nil {
			return nil, fmt.Errorf("insert invited household: %w", err)
		}
	} else {
		if err := tx.QueryRowContext(ctx, `
			SELECT id, name, created_at FROM households WHERE id = ?
		`, inviteHouseholdID).Scan(&targetHousehold.ID, &targetHousehold.Name, &targetHousehold.CreatedAt); err != nil {
			return nil, fmt.Errorf("lookup target household: %w", err)
		}
	}

	user := User{
		ID:          NewID(),
		HouseholdID: targetHousehold.ID,
		Email:       email,
		DisplayName: displayName,
		Role:        role,
		CreatedAt:   nowStr,
	}

	if err := insertUserAndProfileTx(ctx, tx, user, passwordHash, avatarID, accentColor); err != nil {
		return nil, err
	}

	res, err := tx.ExecContext(ctx, `
		UPDATE invites
		SET used_at = ?, used_by_user_id = ?
		WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL
	`, nowStr, user.ID, inviteID)
	if err != nil {
		return nil, fmt.Errorf("mark invite used: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return nil, fmt.Errorf("check used invite rows: %w", err)
	}
	if affected != 1 {
		return nil, ErrInvalidInvite
	}

	rawSession, sessExpiresAt, err := s.createSessionTx(ctx, tx, user.ID)
	if err != nil {
		return nil, err
	}
	profiles, err := listProfilesTx(ctx, tx, targetHousehold.ID)
	if err != nil {
		return nil, err
	}

	return &Result{
		User:             user,
		Household:        targetHousehold,
		Profiles:         profiles,
		RawSessionToken:  rawSession,
		SessionExpiresAt: sessExpiresAt,
	}, nil
}

func insertUserAndProfileTx(
	ctx context.Context,
	tx *sql.Tx,
	user User,
	passwordHash *string,
	avatarID, accentColor string,
) error {
	var pwHash sql.NullString
	if passwordHash != nil && *passwordHash != "" {
		pwHash = sql.NullString{String: *passwordHash, Valid: true}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO users (id, household_id, email, password_hash, display_name, role, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, user.ID, user.HouseholdID, user.Email, pwHash, user.DisplayName, user.Role, user.CreatedAt, user.CreatedAt); err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed: users.email") {
			return ErrEmailExists
		}
		return fmt.Errorf("insert user: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO profiles (id, household_id, user_id, name, avatar_id, accent_color, is_child, friends_visible, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)
	`, NewID(), user.HouseholdID, user.ID, user.DisplayName, avatarID, accentColor, user.CreatedAt, user.CreatedAt); err != nil {
		return fmt.Errorf("insert adult profile: %w", err)
	}

	return nil
}

func insertIdentityTx(ctx context.Context, tx *sql.Tx, userID, issuer, subject, email, createdAt string) error {
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO user_identities (id, user_id, issuer, subject, email, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, NewID(), userID, issuer, subject, email, createdAt); err != nil {
		return fmt.Errorf("insert user identity: %w", err)
	}
	return nil
}

func (s *Store) createSessionTx(ctx context.Context, tx *sql.Tx, userID string) (string, time.Time, error) {
	rawToken, err := GenerateToken()
	if err != nil {
		return "", time.Time{}, err
	}
	nowTime := s.now()
	expiresAt := nowTime.Add(SessionTTL)
	nowStr := FormatTime(nowTime)

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, NewID(), userID, HashToken(rawToken), FormatTime(expiresAt), nowStr, nowStr); err != nil {
		return "", time.Time{}, fmt.Errorf("insert session: %w", err)
	}
	return rawToken, expiresAt, nil
}

type rowQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func listProfilesTx(ctx context.Context, tx *sql.Tx, householdID string) ([]Profile, error) {
	return listProfilesQuery(ctx, tx, householdID)
}

func listProfilesQuery(ctx context.Context, q rowQuerier, householdID string) ([]Profile, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, household_id, user_id, name, avatar_id, accent_color, is_child, friends_visible, created_at, updated_at
		FROM profiles
		WHERE household_id = ?
		ORDER BY is_child ASC, created_at ASC, id ASC
	`, householdID)
	if err != nil {
		return nil, fmt.Errorf("query profiles: %w", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	profiles := make([]Profile, 0)
	for rows.Next() {
		var p Profile
		var userID sql.NullString
		var isChildInt, friendsVisibleInt int
		if err := rows.Scan(
			&p.ID, &p.HouseholdID, &userID, &p.Name, &p.AvatarID, &p.AccentColor, &isChildInt, &friendsVisibleInt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan profile: %w", err)
		}
		if userID.Valid {
			uid := userID.String
			p.UserID = &uid
		}
		p.IsChild = isChildInt == 1
		p.FriendsVisible = friendsVisibleInt == 1
		profiles = append(profiles, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate profiles: %w", err)
	}
	return profiles, nil
}

func scanSingleProfile(ctx context.Context, q rowQuerier, query string, args ...any) (*Profile, error) {
	var p Profile
	var userID sql.NullString
	var isChildInt, friendsVisibleInt int

	err := q.QueryRowContext(ctx, query, args...).Scan(
		&p.ID, &p.HouseholdID, &userID, &p.Name, &p.AvatarID, &p.AccentColor, &isChildInt, &friendsVisibleInt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("scan profile: %w", err)
	}
	if userID.Valid {
		uid := userID.String
		p.UserID = &uid
	}
	p.IsChild = isChildInt == 1
	p.FriendsVisible = friendsVisibleInt == 1
	return &p, nil
}

func computeInviteStatus(now time.Time, expiresRaw string, usedAt, revokedAt *string) string {
	if revokedAt != nil {
		return "revoked"
	}
	if usedAt != nil {
		return "used"
	}
	expiresAt, err := ParseTime(expiresRaw)
	if err != nil || !now.Before(expiresAt) {
		return "expired"
	}
	return "active"
}

func validateRequiredName(field, raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("%w: %s is required", ErrInvalidInput, field)
	}
	if utf8.RuneCountInString(trimmed) > maxNameLength {
		return "", fmt.Errorf("%w: %s exceeds %d characters", ErrInvalidInput, field, maxNameLength)
	}
	return trimmed, nil
}

func normalizeAndValidateEmail(raw string) (string, error) {
	trimmed := strings.ToLower(strings.TrimSpace(raw))
	if trimmed == "" || len(trimmed) > 254 {
		return "", fmt.Errorf("%w: valid email is required", ErrInvalidInput)
	}
	addr, err := mail.ParseAddress(trimmed)
	if err != nil || strings.ToLower(addr.Address) != trimmed || !strings.Contains(trimmed, "@") {
		return "", fmt.Errorf("%w: valid email is required", ErrInvalidInput)
	}
	return trimmed, nil
}

func normalizeVisuals(avatarID, accentColor string) (string, string) {
	a := strings.TrimSpace(avatarID)
	if a == "" || utf8.RuneCountInString(a) > maxMetaLength {
		a = defaultAvatarID
	}
	c := strings.TrimSpace(accentColor)
	if c == "" || utf8.RuneCountInString(c) > maxMetaLength {
		c = defaultAccentColor
	}
	return a, c
}

func defaultHouseholdName(displayName string) string {
	trimmed := strings.TrimSpace(displayName)
	if trimmed == "" {
		return "Hearthside Household"
	}
	return trimmed + "'s Household"
}
