package httpd

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Archives are private, immutable files. Metadata survives service restarts;
// access still requires the original account or an authorized public share.
const nasArchiveTTL = 24 * time.Hour

var nasArchiveJanitor sync.Once
var nasArchiveSlots = make(chan struct{}, 2)
var nasArchiveJobs sync.Map

type nasArchiveState struct {
	State string `json:"state"`
	Size  int64  `json:"size"`
	URL   string `json:"url"`
	Error string `json:"error,omitempty"`
}

func nasArchiveRoot() string { return filepath.Join(os.TempDir(), "air-cloud-archives-v1") }
func nasArchiveOwnerDir(owner string) string {
	sum := sha256.Sum256([]byte(owner))
	return filepath.Join(nasArchiveRoot(), hex.EncodeToString(sum[:]))
}
func cleanupNASArchives(now time.Time) {
	nasArchiveCache.Lock()
	defer nasArchiveCache.Unlock()
	owners, _ := os.ReadDir(nasArchiveRoot())
	for _, owner := range owners {
		if !owner.IsDir() {
			continue
		}
		dir := filepath.Join(nasArchiveRoot(), owner.Name())
		entries, _ := os.ReadDir(dir)
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
				continue
			}
			info, err := entry.Info()
			if err != nil || now.Sub(info.ModTime()) < nasArchiveTTL {
				continue
			}
			id := strings.TrimSuffix(entry.Name(), ".json")
			if _, active := nasArchiveCache.active[filepath.Join(dir, id+".part")]; active {
				continue
			}
			for _, suffix := range []string{".json", ".zip", ".part"} {
				_ = os.Remove(filepath.Join(dir, id+suffix))
			}
		}
	}
}
func writeNASArchiveState(file string, state nasArchiveState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	tmp := file + ".tmp"
	if err = os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, file)
}

type nasArchiveWriter struct {
	ctx     context.Context
	out     io.Writer
	written int64
	limit   int64
}

func (w *nasArchiveWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if w.written+int64(len(p)) > w.limit {
		return 0, errors.New("archive exceeds temporary storage limit")
	}
	n, err := w.out.Write(p)
	w.written += int64(n)
	return n, err
}
func serveNASArchive(w http.ResponseWriter, r *http.Request, owner string) {
	id := r.URL.Query().Get("archive")
	token, err := hex.DecodeString(id)
	if err != nil || len(token) != 16 || strings.ToLower(id) != id {
		http.NotFound(w, r)
		return
	}
	dir := nasArchiveOwnerDir(owner)
	meta := filepath.Join(dir, id+".json")
	info, err := os.Stat(meta)
	if err != nil || time.Since(info.ModTime()) >= nasArchiveTTL {
		http.NotFound(w, r)
		return
	}
	data, err := os.ReadFile(meta)
	var state nasArchiveState
	if err != nil || json.Unmarshal(data, &state) != nil {
		http.NotFound(w, r)
		return
	}
	if state.State == "preparing" {
		if _, active := nasArchiveJobs.Load(id); !active {
			state.State = "failed"
			state.Error = "Archive preparation interrupted"
			_ = writeNASArchiveState(meta, state)
		}
	}
	now := time.Now()
	_ = os.Chtimes(meta, now, now)
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.Query().Get("status") == "1" {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(state)
		return
	}
	if state.State != "ready" {
		http.Error(w, "Archive not ready", 409)
		return
	}
	file, err := os.Open(filepath.Join(dir, id+".zip"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", "attachment; filename=download.zip")
	w.Header().Set("ETag", fmt.Sprintf("\"%s-%x\"", id, info.Size()))
	http.ServeContent(w, r, "download.zip", info.ModTime(), file)
}
