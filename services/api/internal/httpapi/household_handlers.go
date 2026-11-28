package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gemcdaniel/hearthside/services/api/internal/auth"
)

type createInviteRequest struct {
	Mode           string `json:"mode"`
	EmailHint      string `json:"emailHint"`
	ExpiresInHours int    `json:"expiresInHours"`
}

type createInviteResponse struct {
	Invite auth.Invite `json:"invite"`
	Token  string      `json:"token"`
}

func createInviteHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		var req createInviteRequest
		if !decodeJSON(w, r, &req) {
			return
		}

		invite, rawToken, err := store.CreateInvite(r.Context(), sc, auth.CreateInviteInput{
			Mode:           req.Mode,
			EmailHint:      req.EmailHint,
			ExpiresInHours: req.ExpiresInHours,
		})
		if err != nil {
			writeHouseholdError(w, r, logger, "create invite failed", err)
			return
		}

		WriteJSON(w, http.StatusCreated, createInviteResponse{
			Invite: *invite,
			Token:  rawToken,
		})
	}
}

func listInvitesHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		invites, err := store.ListInvites(r.Context(), sc.Household.ID)
		if err != nil {
			writeHouseholdError(w, r, logger, "list invites failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, map[string][]auth.Invite{"invites": invites})
	}
}

func revokeInviteHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		inviteID := r.PathValue("id")
		if err := store.RevokeInvite(r.Context(), sc, inviteID); err != nil {
			writeHouseholdError(w, r, logger, "revoke invite failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func listProfilesHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		profiles, err := store.ListProfiles(r.Context(), sc.Household.ID)
		if err != nil {
			writeHouseholdError(w, r, logger, "list profiles failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, map[string][]auth.Profile{"profiles": profiles})
	}
}

type createProfileRequest struct {
	IsChild     *bool  `json:"isChild"`
	Name        string `json:"name"`
	AvatarID    string `json:"avatarId"`
	AccentColor string `json:"accentColor"`
}

func createProfileHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		var req createProfileRequest
		if !decodeJSON(w, r, &req) {
			return
		}

		if req.IsChild != nil && !*req.IsChild {
			WriteError(w, r, http.StatusBadRequest, "invalid_input", "only child profiles can be created directly")
			return
		}

		profile, err := store.CreateChildProfile(r.Context(), sc.Household.ID, auth.CreateProfileInput{
			Name:        req.Name,
			AvatarID:    req.AvatarID,
			AccentColor: req.AccentColor,
		})
		if err != nil {
			writeHouseholdError(w, r, logger, "create profile failed", err)
			return
		}

		WriteJSON(w, http.StatusCreated, map[string]*auth.Profile{"profile": profile})
	}
}

type updateProfileRequest struct {
	Name           *string `json:"name"`
	AvatarID       *string `json:"avatarId"`
	AccentColor    *string `json:"accentColor"`
	FriendsVisible *bool   `json:"friendsVisible"`
}

func updateProfileHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		var req updateProfileRequest
		if !decodeJSON(w, r, &req) {
			return
		}

		profileID := r.PathValue("id")
		profile, err := store.UpdateProfile(r.Context(), sc, profileID, auth.UpdateProfileInput{
			Name:           req.Name,
			AvatarID:       req.AvatarID,
			AccentColor:    req.AccentColor,
			FriendsVisible: req.FriendsVisible,
		})
		if err != nil {
			writeHouseholdError(w, r, logger, "update profile failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, map[string]*auth.Profile{"profile": profile})
	}
}

func deleteProfileHandler(store *auth.Store, logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sc, ok := sessionFromContext(r.Context())
		if !ok {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "authentication required")
			return
		}

		profileID := r.PathValue("id")
		if err := store.DeleteChildProfile(r.Context(), sc, profileID); err != nil {
			writeHouseholdError(w, r, logger, "delete profile failed", err)
			return
		}

		WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func writeHouseholdError(w http.ResponseWriter, r *http.Request, logger *slog.Logger, contextMsg string, err error) {
	switch {
	case errors.Is(err, auth.ErrNotFound):
		WriteError(w, r, http.StatusNotFound, "not_found", "resource not found")
	case errors.Is(err, auth.ErrCannotDeleteAdultProfile):
		WriteError(w, r, http.StatusForbidden, "cannot_delete_adult_profile", "cannot delete adult or owner profile")
	case errors.Is(err, auth.ErrForbidden):
		WriteError(w, r, http.StatusForbidden, "forbidden", "action not permitted")
	case errors.Is(err, auth.ErrConflict):
		WriteError(w, r, http.StatusConflict, "conflict", "resource cannot be modified in its current state")
	case errors.Is(err, auth.ErrInvalidNickname):
		WriteError(w, r, http.StatusBadRequest, "invalid_nickname", err.Error())
	case errors.Is(err, auth.ErrInvalidInput):
		WriteError(w, r, http.StatusBadRequest, "invalid_input", err.Error())
	default:
		logger.Error(contextMsg,
			slog.String("request_id", RequestIDFromContext(r.Context())),
			slog.String("error", err.Error()),
		)
		WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error")
	}
}
