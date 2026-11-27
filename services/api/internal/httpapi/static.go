package httpapi

import (
	"io"
	"io/fs"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
)

var staticMimeTypes = map[string]string{
	".css":         "text/css; charset=utf-8",
	".gif":         "image/gif",
	".html":        "text/html; charset=utf-8",
	".ico":         "image/x-icon",
	".jpeg":        "image/jpeg",
	".jpg":         "image/jpeg",
	".js":          "text/javascript; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".otf":         "font/otf",
	".png":         "image/png",
	".svg":         "image/svg+xml",
	".ttf":         "font/ttf",
	".txt":         "text/plain; charset=utf-8",
	".wasm":        "application/wasm",
	".webmanifest": "application/manifest+json",
	".webp":        "image/webp",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".xml":         "application/xml; charset=utf-8",
}

var assetExtensions = map[string]bool{
	".css":         true,
	".gif":         true,
	".gz":          true,
	".ico":         true,
	".jpeg":        true,
	".jpg":         true,
	".js":          true,
	".json":        true,
	".map":         true,
	".mjs":         true,
	".mp3":         true,
	".ogg":         true,
	".otf":         true,
	".png":         true,
	".svg":         true,
	".ttf":         true,
	".txt":         true,
	".wasm":        true,
	".wav":         true,
	".webmanifest": true,
	".webp":        true,
	".woff":        true,
	".woff2":       true,
	".xml":         true,
}

func pathTraversalGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawPath := r.URL.EscapedPath()
		if hasTraversalAttempt(r.URL.Path) || hasTraversalAttempt(rawPath) {
			WriteError(w, r, http.StatusBadRequest, "invalid_path", "invalid request path")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func hasTraversalAttempt(p string) bool {
	if strings.Contains(p, "\\") || strings.ContainsRune(p, '\x00') {
		return true
	}
	if unescaped, err := url.PathUnescape(p); err == nil {
		if strings.Contains(unescaped, "\\") || strings.ContainsRune(unescaped, '\x00') {
			return true
		}
		for _, seg := range strings.Split(unescaped, "/") {
			if seg == ".." {
				return true
			}
		}
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return true
		}
	}
	return false
}

func apiNotFoundHandler(w http.ResponseWriter, _ *http.Request) {
	WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not_found"})
}

func newStaticPWAHandler(webDir string) http.Handler {
	fsys := os.DirFS(webDir)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			WriteError(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "method not allowed")
			return
		}

		cleanURL := path.Clean("/" + r.URL.Path)
		relPath := strings.TrimPrefix(cleanURL, "/")
		if relPath == "" {
			relPath = "index.html"
		}

		info, err := fs.Stat(fsys, relPath)
		switch {
		case err == nil && !info.IsDir():
			serveStaticFile(w, r, fsys, relPath, info)
			return
		case err == nil && info.IsDir():
			idxPath := relPath + "/index.html"
			if idxInfo, idxErr := fs.Stat(fsys, idxPath); idxErr == nil && !idxInfo.IsDir() {
				serveStaticFile(w, r, fsys, idxPath, idxInfo)
				return
			}
			http.NotFound(w, r)
			return
		}

		if looksLikeAssetPath(relPath) {
			http.NotFound(w, r)
			return
		}

		indexInfo, indexErr := fs.Stat(fsys, "index.html")
		if indexErr != nil || indexInfo.IsDir() {
			http.NotFound(w, r)
			return
		}
		serveStaticFile(w, r, fsys, "index.html", indexInfo)
	})
}

func serveStaticFile(w http.ResponseWriter, r *http.Request, fsys fs.FS, relPath string, rawInfo fs.FileInfo) {
	contentType := contentTypeForPath(relPath)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", cacheControlForPath(relPath))

	servePath := relPath
	serveInfo := rawInfo

	if !strings.HasSuffix(strings.ToLower(relPath), ".gz") {
		gzPath := relPath + ".gz"
		if gzInfo, gzErr := fs.Stat(fsys, gzPath); gzErr == nil && !gzInfo.IsDir() {
			w.Header().Add("Vary", "Accept-Encoding")
			if acceptsGzip(r.Header.Get("Accept-Encoding")) {
				w.Header().Set("Content-Encoding", "gzip")
				servePath = gzPath
				serveInfo = gzInfo
			}
		}
	}

	f, err := fsys.Open(servePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer func() {
		_ = f.Close()
	}()

	rs, ok := f.(io.ReadSeeker)
	if !ok {
		http.Error(w, "internal server error", http.StatusInternalServerError)
		return
	}

	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	http.ServeContent(w, r, "", serveInfo.ModTime(), rs)
}

func contentTypeForPath(relPath string) string {
	ext := strings.ToLower(path.Ext(relPath))
	if ct, ok := staticMimeTypes[ext]; ok {
		return ct
	}
	if ct := mime.TypeByExtension(ext); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func cacheControlForPath(relPath string) string {
	if strings.HasPrefix(relPath, "assets/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
}

func looksLikeAssetPath(relPath string) bool {
	if strings.HasPrefix(relPath, "assets/") {
		return true
	}
	ext := strings.ToLower(path.Ext(relPath))
	return assetExtensions[ext]
}

func acceptsGzip(header string) bool {
	if header == "" {
		return false
	}
	for _, part := range strings.Split(header, ",") {
		fields := strings.Split(strings.TrimSpace(part), ";")
		if len(fields) == 0 {
			continue
		}
		coding := strings.ToLower(strings.TrimSpace(fields[0]))
		if coding != "gzip" {
			continue
		}
		allowed := true
		for _, param := range fields[1:] {
			k, v, hasEq := strings.Cut(strings.TrimSpace(param), "=")
			if hasEq && strings.EqualFold(strings.TrimSpace(k), "q") {
				q, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
				if err == nil && q == 0 {
					allowed = false
				}
			}
		}
		if allowed {
			return true
		}
	}
	return false
}
