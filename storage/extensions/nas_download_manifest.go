package httpd

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"

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
type nasDownloadManifest struct {
	Files       []nasDownloadEntry `json:"files"`
	Directories []string           `json:"directories"`
	Total       int64              `json:"total"`
}

func (s *httpdServer) handleNASDownloadManifest(w http.ResponseWriter, r *http.Request) {
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
	defer common.Connections.Remove(conn.GetID())
	base := conn.User.GetCleanedPath(r.URL.Query().Get("path"))
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
	defer conn.CloseFS()
	if err = validateBrowsableShare(share, conn); err != nil {
		http.Error(w, "Invalid share", 403)
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
	defer common.Connections.Remove(conn.GetID())
	renderNASDownloadManifest(w, r, conn, base, selected, &share)
}
