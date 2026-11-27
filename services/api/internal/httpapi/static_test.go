package httpapi

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gemcdaniel/hearthside/services/api/internal/config"
	"github.com/gemcdaniel/hearthside/services/api/internal/db"
)

func gzipBytes(t *testing.T, raw []byte) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(raw); err != nil {
		t.Fatalf("gzip write failed: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("gzip close failed: %v", err)
	}
	return buf.Bytes()
}

func setupStaticWebDir(t *testing.T) string {
	t.Helper()
	webDir := t.TempDir()

	writeWithGz := func(rel string, content []byte) {
		full := filepath.Join(webDir, rel)
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
			t.Fatalf("mkdir %s: %v", rel, err)
		}
		if err := os.WriteFile(full, content, 0o600); err != nil {
			t.Fatalf("write %s: %v", rel, err)
		}
		if err := os.WriteFile(full+".gz", gzipBytes(t, content), 0o600); err != nil {
			t.Fatalf("write %s.gz: %v", rel, err)
		}
	}

	writeWithGz("index.html", []byte("<!doctype html><html><body>Hearthside</body></html>"))
	writeWithGz("sw.js", []byte("self.addEventListener('fetch', () => {});"))
	writeWithGz("manifest.webmanifest", []byte(`{"name":"Hearthside"}`))
	writeWithGz("assets/app-abc123.js", []byte("console.log('hearthside');"))
	writeWithGz("wasm/sudoku-go.wasm", []byte{0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00})
	if err := os.WriteFile(filepath.Join(webDir, "registerSW.js"), []byte("// sw"), 0o600); err != nil {
		t.Fatalf("write registerSW.js: %v", err)
	}
	return webDir
}

func newStaticHandler(t *testing.T, webDir string) http.Handler {
	t.Helper()
	ctx := context.Background()
	database, err := db.Open(ctx, ":memory:")
	if err != nil {
		t.Fatalf("db.Open: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})
	return NewHandler(Dependencies{
		DB: database,
		Config: config.Config{
			PublicBaseURL: testPublicBaseURL,
			WebDir:        webDir,
		},
	})
}

func TestStaticPWAServingAndCompression(t *testing.T) {
	webDir := setupStaticWebDir(t)
	handler := newStaticHandler(t, webDir)

	// 1. .wasm serves application/wasm and pre-compressed .gz when gzip is accepted.
	req := httptest.NewRequest(http.MethodGet, "/wasm/sudoku-go.wasm", nil)
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("wasm status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/wasm" {
		t.Fatalf("wasm Content-Type = %q, want application/wasm", ct)
	}
	if ce := rec.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("wasm Content-Encoding = %q, want gzip", ce)
	}
	if vary := rec.Header().Get("Vary"); !strings.Contains(vary, "Accept-Encoding") {
		t.Fatalf("wasm Vary = %q, want Accept-Encoding", vary)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("wasm Cache-Control = %q, want no-cache", cc)
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("open gzip response: %v", err)
	}
	unzipped, err := io.ReadAll(zr)
	_ = zr.Close()
	if err != nil || !bytes.Equal(unzipped, []byte{0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00}) {
		t.Fatalf("unexpected gunzipped wasm bytes: %v err=%v", unzipped, err)
	}

	// 2. Without Accept-Encoding: gzip, raw uncompressed bytes are returned.
	rawReq := httptest.NewRequest(http.MethodGet, "/wasm/sudoku-go.wasm", nil)
	rawRec := httptest.NewRecorder()
	handler.ServeHTTP(rawRec, rawReq)
	if rawRec.Code != http.StatusOK || rawRec.Header().Get("Content-Encoding") != "" {
		t.Fatalf("raw wasm status=%d ce=%q", rawRec.Code, rawRec.Header().Get("Content-Encoding"))
	}
	if !bytes.Equal(rawRec.Body.Bytes(), []byte{0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00}) {
		t.Fatalf("unexpected raw wasm body: %v", rawRec.Body.Bytes())
	}

	// 3. .webmanifest MIME type and no-cache header.
	mfRec := httptest.NewRecorder()
	handler.ServeHTTP(mfRec, httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil))
	if mfRec.Code != http.StatusOK || mfRec.Header().Get("Content-Type") != "application/manifest+json" {
		t.Fatalf("manifest status=%d ct=%q", mfRec.Code, mfRec.Header().Get("Content-Type"))
	}
	if cc := mfRec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("manifest Cache-Control = %q, want no-cache", cc)
	}

	// 4. sw.js, registerSW.js, and /assets/* cache headers.
	swRec := httptest.NewRecorder()
	handler.ServeHTTP(swRec, httptest.NewRequest(http.MethodGet, "/sw.js", nil))
	if swRec.Code != http.StatusOK || swRec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("sw.js status=%d cc=%q", swRec.Code, swRec.Header().Get("Cache-Control"))
	}

	regRec := httptest.NewRecorder()
	handler.ServeHTTP(regRec, httptest.NewRequest(http.MethodGet, "/registerSW.js", nil))
	if regRec.Code != http.StatusOK || regRec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("registerSW.js status=%d cc=%q", regRec.Code, regRec.Header().Get("Cache-Control"))
	}

	assetReq := httptest.NewRequest(http.MethodGet, "/assets/app-abc123.js", nil)
	assetReq.Header.Set("Accept-Encoding", "gzip")
	assetRec := httptest.NewRecorder()
	handler.ServeHTTP(assetRec, assetReq)
	if assetRec.Code != http.StatusOK {
		t.Fatalf("asset status = %d, want 200", assetRec.Code)
	}
	if cc := assetRec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("asset Cache-Control = %q", cc)
	}
	if ct := assetRec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("asset Content-Type = %q", ct)
	}
}

func TestStaticSPAFallbackAPIBoundaryAndTraversalGuard(t *testing.T) {
	webDir := setupStaticWebDir(t)
	handler := newStaticHandler(t, webDir)

	// 1. Client-side route falls back to index.html (and supports index.html.gz).
	spaReq := httptest.NewRequest(http.MethodGet, "/play/sudoku", nil)
	spaReq.Header.Set("Accept-Encoding", "gzip")
	spaRec := httptest.NewRecorder()
	handler.ServeHTTP(spaRec, spaReq)
	if spaRec.Code != http.StatusOK {
		t.Fatalf("SPA fallback status = %d, want 200", spaRec.Code)
	}
	if cc := spaRec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("SPA fallback Cache-Control = %q, want no-cache", cc)
	}
	if ce := spaRec.Header().Get("Content-Encoding"); ce != "gzip" {
		t.Fatalf("SPA fallback Content-Encoding = %q, want gzip", ce)
	}
	if ct := spaRec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("SPA fallback Content-Type = %q, want text/html", ct)
	}

	// 2. Missing static assets return real 404 (not index.html).
	for _, missingAsset := range []string{"/assets/missing.js", "/missing.wasm", "/icons/missing.png"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, missingAsset, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("GET %s = %d, want 404", missingAsset, rec.Code)
		}
	}

	// 3. Healthz works and unmatched /api/v1/* returns JSON 404 {"error":"not_found"}.
	healthRec := httptest.NewRecorder()
	handler.ServeHTTP(healthRec, httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil))
	if healthRec.Code != http.StatusOK {
		t.Fatalf("healthz = %d, want 200", healthRec.Code)
	}

	for _, apiPath := range []string{"/api", "/api/v1/unknown", "/api/something"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, apiPath, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatalf("GET %s = %d, want 404", apiPath, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Fatalf("GET %s Content-Type = %q", apiPath, ct)
		}
		if strings.TrimSpace(rec.Body.String()) != `{"error":"not_found"}` {
			t.Fatalf("GET %s body = %q, want {\"error\":\"not_found\"}", apiPath, rec.Body.String())
		}
	}

	// 4. Path traversal attempts are rejected safely.
	for _, badPath := range []string{"/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/assets/../../etc/passwd"} {
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, badPath, nil))
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("traversal path %s = %d, want 400", badPath, rec.Code)
		}
	}
}

func TestAPIOnlyModeWhenWebDirEmpty(t *testing.T) {
	handler := newStaticHandler(t, "")

	rootRec := httptest.NewRecorder()
	handler.ServeHTTP(rootRec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rootRec.Code != http.StatusNotFound {
		t.Fatalf("API-only GET / = %d, want 404", rootRec.Code)
	}

	healthRec := httptest.NewRecorder()
	handler.ServeHTTP(healthRec, httptest.NewRequest(http.MethodGet, "/api/v1/healthz", nil))
	if healthRec.Code != http.StatusOK {
		t.Fatalf("API-only GET /api/v1/healthz = %d, want 200", healthRec.Code)
	}

	apiMissRec := httptest.NewRecorder()
	handler.ServeHTTP(apiMissRec, httptest.NewRequest(http.MethodGet, "/api/v1/does-not-exist", nil))
	if apiMissRec.Code != http.StatusNotFound || strings.TrimSpace(apiMissRec.Body.String()) != `{"error":"not_found"}` {
		t.Fatalf("API-only unknown API = %d %q", apiMissRec.Code, apiMissRec.Body.String())
	}
}
