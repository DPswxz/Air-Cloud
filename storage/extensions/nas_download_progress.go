package httpd

import (
	"crypto/rand"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/drakkan/sftpgo/v2/internal/jwt"
	"github.com/go-chi/render"
)

type nasDownloadJob struct {
	ID      string `json:"id"`
	Owner   string `json:"-"`
	Status  string `json:"status"`
	Bytes   int64  `json:"bytes"`
	Total   int64  `json:"total"`
	Updated int64  `json:"updated"`
}

var nasDownloads = struct {
	sync.Mutex
	jobs map[string]*nasDownloadJob
}{jobs: make(map[string]*nasDownloadJob)}

func (s *httpdServer) createNASDownloadJob(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if r.ParseForm() != nil || verifyCSRFToken(r, s.csrfTokenAuth) != nil {
		http.Error(w, "Invalid form", 403)
		return
	}
	claims, err := jwt.FromContext(r.Context())
	if err != nil || claims.Username == "" {
		http.Error(w, "Forbidden", 403)
		return
	}
	nasDownloads.Lock()
	active := 0
	now := time.Now().UnixMilli()
	for id, job := range nasDownloads.jobs {
		if now-job.Updated > 2*60*60*1000 || (job.Status != "downloading" && now-job.Updated > 30*60*1000) {
			delete(nasDownloads.jobs, id)
			continue
		}
		if job.Owner == claims.Username && (job.Status == "queued" || job.Status == "downloading") {
			active++
		}
	}
	if active >= 4 || len(nasDownloads.jobs) >= 256 {
		nasDownloads.Unlock()
		http.Error(w, "Too many downloads", 429)
		return
	}
	job := &nasDownloadJob{ID: rand.Text(), Owner: claims.Username, Status: "queued", Updated: now}
	nasDownloads.jobs[job.ID] = job
	snapshot := *job
	nasDownloads.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	render.JSON(w, r, snapshot)
}

func getNASDownloadProgress(w http.ResponseWriter, r *http.Request) {
	claims, err := jwt.FromContext(r.Context())
	if err != nil {
		http.Error(w, "Forbidden", 403)
		return
	}
	nasDownloads.Lock()
	job, ok := nasDownloads.jobs[getURLParam(r, "id")]
	if !ok || job.Owner != claims.Username {
		nasDownloads.Unlock()
		http.NotFound(w, r)
		return
	}
	snapshot := *job
	nasDownloads.Unlock()
	w.Header().Set("Cache-Control", "no-store")
	render.JSON(w, r, snapshot)
}

type nasDownloadWriter struct {
	http.ResponseWriter
	job        *nasDownloadJob
	status     int
	writeError bool
}

func (w *nasDownloadWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *nasDownloadWriter) Write(data []byte) (int, error) {
	n, err := w.ResponseWriter.Write(data)
	nasDownloads.Lock()
	w.job.Bytes += int64(n)
	w.job.Updated = time.Now().UnixMilli()
	if w.status < 400 {
		w.job.Status = "downloading"
	}
	if total, err := strconv.ParseInt(w.Header().Get("Content-Length"), 10, 64); err == nil {
		w.job.Total = total
	}
	nasDownloads.Unlock()
	if err != nil {
		w.writeError = true
	}
	return n, err
}
func (w *nasDownloadWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
func (w *nasDownloadWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (s *httpdServer) handleNASZipDownload(w http.ResponseWriter, r *http.Request) {
	s.handleNASDownload(w, r, s.handleWebClientDownloadZip)
}
func (s *httpdServer) handleNASFileDownload(w http.ResponseWriter, r *http.Request) {
	if s.showNASBackgroundShell(w, r) {
		return
	}
	s.handleNASDownload(w, r, s.handleClientGetFiles)
}
func (s *httpdServer) handleNASDownload(w http.ResponseWriter, r *http.Request, handler http.HandlerFunc) {
	id := r.URL.Query().Get("progress_id")
	if id == "" {
		handler(w, r)
		return
	}
	claims, err := jwt.FromContext(r.Context())
	if err != nil {
		http.Error(w, "Forbidden", 403)
		return
	}
	nasDownloads.Lock()
	job, ok := nasDownloads.jobs[id]
	if !ok || job.Owner != claims.Username || job.Status != "queued" {
		nasDownloads.Unlock()
		http.NotFound(w, r)
		return
	}
	job.Status = "downloading"
	job.Updated = time.Now().UnixMilli()
	nasDownloads.Unlock()
	counter := &nasDownloadWriter{ResponseWriter: w, job: job, status: 200}
	defer func() {
		panicValue := recover()
		nasDownloads.Lock()
		job.Updated = time.Now().UnixMilli()
		if panicValue != nil || counter.status >= 400 || !strings.Contains(w.Header().Get("Content-Disposition"), "attachment") {
			job.Status = "failed"
		} else if counter.writeError || r.Context().Err() != nil {
			job.Status = "interrupted"
		} else {
			job.Status = "completed"
		}
		nasDownloads.Unlock()
		if panicValue != nil {
			panic(panicValue)
		}
	}()
	handler(counter, r)
}
