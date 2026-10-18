package httpd

import (
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const nasRecyclePageSize = 200

type nasRecycleChild struct {
	Name      string `json:"name"`
	Path      string `json:"path"`
	Bytes     int64  `json:"bytes"`
	Directory bool   `json:"directory"`
}

type nasRecyclePage struct {
	Items      []nasRecycleChild `json:"items"`
	More       bool              `json:"more"`
	NextOffset int               `json:"next_offset"`
}

// Browse only a single directory inside the stored payload, without following links.
func nasRecycleChildren(payload, relative string, offset int) (nasRecyclePage, error) {
	result := nasRecyclePage{Items: make([]nasRecycleChild, 0), NextOffset: offset}
	if offset < 0 || offset > 1000000 || len(relative) > 4096 || strings.ContainsAny(relative, "\\:\x00") || (relative != "" && (path.Clean(relative) != relative || !filepath.IsLocal(filepath.FromSlash(relative)))) {
		return result, os.ErrPermission
	}
	current := payload
	parts := []string{""}
	if relative != "" {
		parts = append(parts, strings.Split(relative, "/")...)
	}
	for _, part := range parts {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return result, err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return result, os.ErrPermission
		}
	}
	directory, err := os.Open(current)
	if err != nil {
		return result, err
	}
	defer directory.Close()
	for skipped := 0; skipped < offset; {
		count := min(nasRecyclePageSize, offset-skipped)
		entries, err := directory.ReadDir(count)
		skipped += len(entries)
		if err == io.EOF {
			return result, nil
		}
		if err != nil {
			return result, err
		}
	}
	entries, err := directory.ReadDir(nasRecyclePageSize + 1)
	if err != nil && err != io.EOF {
		return result, err
	}
	if len(entries) > nasRecyclePageSize {
		result.More = true
		entries = entries[:nasRecyclePageSize]
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return result, err
		}
		child := nasRecycleChild{Name: entry.Name(), Path: path.Join(relative, entry.Name()), Directory: info.IsDir() && info.Mode()&os.ModeSymlink == 0}
		if !child.Directory {
			child.Bytes = info.Size()
		}
		result.Items = append(result.Items, child)
	}
	result.NextOffset = offset + len(entries)
	sort.Slice(result.Items, func(i, j int) bool {
		a, b := result.Items[i], result.Items[j]
		if a.Directory != b.Directory {
			return a.Directory
		}
		return a.Name < b.Name
	})
	return result, nil
}
