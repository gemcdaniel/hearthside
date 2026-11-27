package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
)

const maxJSONBodyBytes = 64 * 1024

// CSRFMiddleware enforces same-origin Origin/Referer checks on all mutating HTTP requests.
func CSRFMiddleware(publicBaseURL string, next http.Handler) http.Handler {
	expectedScheme, expectedHost := parseOriginParts(publicBaseURL)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}

		if expectedScheme == "" || expectedHost == "" {
			WriteError(w, r, http.StatusForbidden, "csrf_origin_mismatch", "origin verification failed")
			return
		}

		if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
			if !matchesExpectedOrigin(origin, expectedScheme, expectedHost) {
				WriteError(w, r, http.StatusForbidden, "csrf_origin_mismatch", "cross-origin request blocked")
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		if referer := strings.TrimSpace(r.Header.Get("Referer")); referer != "" {
			if !matchesExpectedOrigin(referer, expectedScheme, expectedHost) {
				WriteError(w, r, http.StatusForbidden, "csrf_origin_mismatch", "cross-origin request blocked")
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		WriteError(w, r, http.StatusForbidden, "csrf_origin_mismatch", "missing Origin or Referer header")
	})
}

func parseOriginParts(rawURL string) (scheme, host string) {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", ""
	}
	return strings.ToLower(u.Scheme), strings.ToLower(u.Host)
}

func matchesExpectedOrigin(rawHeader, expectedScheme, expectedHost string) bool {
	if strings.EqualFold(rawHeader, "null") {
		return false
	}
	scheme, host := parseOriginParts(rawHeader)
	return scheme == expectedScheme && host == expectedHost
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	return decodeJSONWithLimit(w, r, dst, maxJSONBodyBytes)
}

func decodeJSONWithLimit(w http.ResponseWriter, r *http.Request, dst any, maxBytes int64) bool {
	contentType := strings.TrimSpace(r.Header.Get("Content-Type"))
	if contentType == "" {
		WriteError(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json")
		return false
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.EqualFold(mediaType, "application/json") {
		WriteError(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json")
		return false
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			WriteError(w, r, http.StatusRequestEntityTooLarge, "payload_too_large", "request body too large")
			return false
		}
		if errors.Is(err, io.EOF) {
			WriteError(w, r, http.StatusBadRequest, "invalid_json", "request body must not be empty")
			return false
		}
		WriteError(w, r, http.StatusBadRequest, "invalid_json", "malformed JSON request body")
		return false
	}

	return true
}
