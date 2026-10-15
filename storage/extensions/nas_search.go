package httpd

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"time"
)

// Search uses the authenticated virtual filesystem; inaccessible directories are skipped.
func renderNASRecursiveSearch(w http.ResponseWriter, r *http.Request, c *Connection, query string) {
	if len([]rune(query)) > 128 {
		http.Error(w, "Search is too long", http.StatusBadRequest)
		return
	}
	type entry struct {
		Name      string `json:"name"`
		Parent    string `json:"parent"`
		URL       string `json:"url"`
		ParentURL string `json:"parent_url"`
		Directory bool   `json:"directory"`
	}
	results := make([]entry, 0)
	queue := []string{"/"}
	scanned := 0
	partial := false
	deadline := time.Now().Add(12 * time.Second)
	needle := strings.ToLower(query)
outer:
	for len(queue) > 0 {
		if r.Context().Err() != nil {
			return
		}
		if scanned >= 100000 || len(results) >= 2000 || time.Now().After(deadline) {
			partial = true
			break
		}
		dir := queue[0]
		queue = queue[1:]
		lister, err := c.ReadDir(dir)
		if err != nil {
			continue
		}
		for {
			infos, err := lister.Next(256)
			if err != nil && !errors.Is(err, io.EOF) {
				break
			}
			for _, info := range infos {
				scanned++
				if scanned > 100000 || len(results) >= 2000 || time.Now().After(deadline) {
					partial = true
					lister.Close()
					break outer
				}
				if r.Context().Err() != nil {
					lister.Close()
					return
				}
				if strings.HasPrefix(info.Name(), ".sftpgo-upload.") {
					continue
				}
				child := path.Join(dir, info.Name())
				if info.IsDir() && info.Mode()&os.ModeSymlink == 0 {
					queue = append(queue, child)
				}
				if strings.Contains(strings.ToLower(info.Name()), needle) {
					results = append(results, entry{Name: info.Name(), Parent: dir, URL: getFileObjectURL(dir, info.Name(), webClientFilesPath), ParentURL: getFileObjectURL(dir, "", webClientFilesPath), Directory: info.IsDir()})
				}
			}
			if err != nil {
				break
			}
		}
		lister.Close()
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{"results": results, "partial": partial, "scanned": scanned})
}
