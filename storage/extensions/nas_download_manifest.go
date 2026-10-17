package httpd

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/klauspost/compress/zip"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/drakkan/sftpgo/v2/internal/common"
	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/vfs"
	"github.com/go-chi/render"
)

type nasDownloadEntry struct {
	Name     string `json:"name"`
	Relative string `json:"relative"`
	URL      string `json:"url"`
	Size     int64  `json:"size"`
}

// Archives are private, immutable files. Metadata survives service restarts;
// access still requires the original account or an authorized public share.
const nasArchiveTTL = 24 * time.Hour
const nasArchiveLimit int64 = 16 << 30

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
}

func (w *nasArchiveWriter) Write(p []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	if w.written+int64(len(p)) > nasArchiveLimit {
		return 0, errors.New("archive exceeds temporary storage limit")
	}
	n, err := w.out.Write(p)
	w.written += int64(n)
	return n, err
}
func startNASArchive(w http.ResponseWriter, r *http.Request, conn *Connection, base string, selected []string, owner string, release func()) {
	for _, name := range selected {
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\") {
			release()
			http.Error(w, "Invalid selection", 400)
			return
		}
	}
	select {
	case nasArchiveSlots <- struct{}{}:
	default:
		release()
		http.Error(w, "Archive preparation busy", 429)
		return
	}
	nasArchiveJanitor.Do(func() {
		cleanupNASArchives(time.Now())
		go func() {
			for range time.NewTicker(30 * time.Minute).C {
				cleanupNASArchives(time.Now())
			}
		}()
	})
	dir := nasArchiveOwnerDir(owner)
	if err := os.MkdirAll(dir, 0700); err != nil {
		<-nasArchiveSlots
		release()
		http.Error(w, "Temporary storage unavailable", 507)
		return
	}
	// Bound retained disk use per account as well as each generated archive.
	entries, _ := os.ReadDir(dir)
	var retained int64
	count := 0
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".zip") || strings.HasSuffix(entry.Name(), ".part") {
			if info, err := entry.Info(); err == nil {
				retained += info.Size()
				count++
			}
		}
	}
	if count >= 16 || retained >= 32<<30 {
		<-nasArchiveSlots
		release()
		http.Error(w, "Temporary archive quota exceeded", 507)
		return
	}
	token := make([]byte, 16)
	if _, err := rand.Read(token); err != nil {
		<-nasArchiveSlots
		release()
		http.Error(w, "Unable to create archive", 500)
		return
	}
	id := hex.EncodeToString(token)
	target := *r.URL
	q := target.Query()
	q.Set("archive", id)
	q.Del("status")
	q.Del("air_raw")
	target.RawQuery = q.Encode()
	state := nasArchiveState{State: "preparing", URL: target.RequestURI()}
	meta := filepath.Join(dir, id+".json")
	if err := writeNASArchiveState(meta, state); err != nil {
		<-nasArchiveSlots
		release()
		http.Error(w, "Temporary storage unavailable", 507)
		return
	}
	nasArchiveJobs.Store(id, struct{}{})
	conn.rc = nil
	conn.request = conn.request.Clone(context.Background())
	go func() {
		defer nasArchiveJobs.Delete(id)
		defer release()
		defer func() { <-nasArchiveSlots }()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Hour)
		defer cancel()
		part := filepath.Join(dir, id+".part")
		final := filepath.Join(dir, id+".zip")
		defer func() {
			_ = os.Remove(part)
			if recover() != nil {
				state.State = "failed"
				state.Error = "Unable to prepare archive"
				_ = writeNASArchiveState(meta, state)
			}
		}()
		file, err := os.OpenFile(part, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err == nil {
			defer file.Close()
			wr := zip.NewWriter(&nasArchiveWriter{ctx: ctx, out: file})
			for _, name := range selected {
				err = addZipEntry(wr, conn, conn.User.GetCleanedPath(path.Join(base, name)), base, nil, 0)
				if err != nil {
					break
				}
			}
			closeErr := wr.Close()
			if err == nil {
				err = closeErr
			}
			closeErr = file.Close()
			if err == nil {
				err = closeErr
			}
			if err == nil {
				err = os.Rename(part, final)
			}
		}
		if err != nil {
			state.State = "failed"
			state.Error = "Unable to prepare archive"
		} else {
			info, statErr := os.Stat(final)
			if statErr != nil {
				state.State = "failed"
				state.Error = "Unable to prepare archive"
			} else {
				state.State = "ready"
				state.Size = info.Size()
			}
		}
		_ = writeNASArchiveState(meta, state)
	}()
	w.Header().Set("Cache-Control", "no-store")
	render.JSON(w, r, state)
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
		render.JSON(w, r, state)
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

type nasDownloadManifest struct {
	Files       []nasDownloadEntry `json:"files"`
	Directories []string           `json:"directories"`
	Total       int64              `json:"total"`
}

func (s *httpdServer) handleNASDownloadManifest(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		conn, err := getUserConnection(w, r)
		if err != nil {
			return
		}
		defer common.Connections.Remove(conn.GetID())
		serveNASArchive(w, r, "user:"+conn.User.Username)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2*1024*1024)
	if r.ParseForm() != nil || verifyCSRFToken(r, s.csrfTokenAuth) != nil {
		http.Error(w, "Invalid form", 403)
		return
	}
	var selected []string
	if json.Unmarshal([]byte(r.Form.Get("files")), &selected) != nil || len(selected) == 0 || len(selected) > 25000 {
		http.Error(w, "Invalid selection", 400)
		return
	}
	conn, err := getUserConnection(w, r)
	if err != nil {
		return
	}
	release := true
	defer func() {
		if release {
			common.Connections.Remove(conn.GetID())
		}
	}()
	base := conn.User.GetCleanedPath(r.URL.Query().Get("path"))
	if r.URL.Query().Get("archive") == "prepare" {
		release = false
		startNASArchive(w, r, conn, base, selected, "user:"+conn.User.Username, func() { common.Connections.Remove(conn.GetID()) })
		return
	}
	renderNASDownloadManifest(w, r, conn, base, selected, nil)
}
func renderNASDownloadManifest(w http.ResponseWriter, r *http.Request, conn *Connection, base string, selected []string, share *dataprovider.Share) {
	result := nasDownloadManifest{Files: []nasDownloadEntry{}, Directories: []string{}}
	visited := map[string]bool{}
	var walk func(string, string, int) error
	walk = func(entry, relative string, depth int) error {
		if strings.HasPrefix(path.Base(entry), ".sftpgo-upload.") {
			return nil
		}
		if depth > 128 || len(visited) >= 25000 {
			return errors.New("too many entries; please download smaller batches")
		}
		if visited[entry] {
			return nil
		}
		visited[entry] = true
		info, err := conn.Stat(entry, 1)
		if err != nil {
			return err
		}
		if info.IsDir() {
			result.Directories = append(result.Directories, relative)
			lister, err := conn.ReadDir(entry)
			if err != nil {
				return err
			}
			defer lister.Close()
			for {
				items, readErr := lister.Next(vfs.ListerBatchSize)
				if readErr != nil && !errors.Is(readErr, io.EOF) {
					return readErr
				}
				for _, item := range items {
					if err := walk(path.Join(entry, item.Name()), path.Join(relative, item.Name()), depth+1); err != nil {
						return err
					}
				}
				if errors.Is(readErr, io.EOF) {
					break
				}
			}
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		if !conn.User.HasPerm(dataprovider.PermDownload, path.Dir(entry)) {
			return errors.New("download permission denied")
		}
		downloadURL := webClientFilesPath + "?air_raw=1&path=" + url.QueryEscape(entry)
		if share != nil {
			downloadURL = path.Join(webClientPubSharesPath, share.ShareID, "browse") + "?air_raw=1&path=" + url.QueryEscape(share.GetRelativePath(entry))
		}
		result.Files = append(result.Files, nasDownloadEntry{Name: info.Name(), Relative: relative, Size: info.Size(), URL: downloadURL})
		result.Total += info.Size()
		return nil
	}
	for _, name := range selected {
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\") {
			http.Error(w, "Invalid selection", 400)
			return
		}
		entry := conn.User.GetCleanedPath(path.Join(base, name))
		if err := walk(entry, path.Base(entry), 0); err != nil {
			sendAPIResponse(w, r, err, "Unable to prepare download", getRespStatus(err))
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	render.JSON(w, r, result)
}

func (s *httpdServer) handleNASShareDownloadManifest(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 2*1024*1024)
	if r.ParseForm() != nil {
		http.Error(w, "Invalid form", 400)
		return
	}
	share, conn, err := s.checkPublicShare(w, r, []dataprovider.ShareScope{dataprovider.ShareScopeRead, dataprovider.ShareScopeReadWrite})
	if err != nil {
		return
	}
	release := true
	defer func() {
		if release {
			conn.CloseFS()
		}
	}()
	if err = validateBrowsableShare(share, conn); err != nil {
		http.Error(w, "Invalid share", 403)
		return
	}
	if r.Method == http.MethodGet {
		serveNASArchive(w, r, "share:"+share.ShareID+":"+conn.User.Username)
		return
	}
	base, err := getBrowsableSharedPath(share.Paths[0], r)
	if err != nil {
		http.Error(w, "Invalid path", 403)
		return
	}
	var selected []string
	if json.Unmarshal([]byte(r.Form.Get("files")), &selected) != nil || len(selected) == 0 || len(selected) > 25000 {
		http.Error(w, "Invalid selection", 400)
		return
	}
	if err = common.Connections.Add(conn); err != nil {
		http.Error(w, "Too many requests", 429)
		return
	}
	defer func() {
		if release {
			common.Connections.Remove(conn.GetID())
		}
	}()
	if r.URL.Query().Get("archive") == "prepare" {
		release = false
		startNASArchive(w, r, conn, base, selected, "share:"+share.ShareID+":"+conn.User.Username, func() { common.Connections.Remove(conn.GetID()); conn.CloseFS() })
		return
	}
	renderNASDownloadManifest(w, r, conn, base, selected, &share)
}
