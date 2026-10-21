package httpd

import (
	"path/filepath"
	"regexp"
	"strings"
)

var nasBackupNameRe = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.zip$`)

// nasBackupValidName accepts only plain archive names so request data can never choose a path.
func nasBackupValidName(name string) bool {
	return nasBackupNameRe.MatchString(name)
}

// nasBackupInside reports whether candidate is root or located below root.
func nasBackupInside(root, candidate string) bool {
	rel, err := filepath.Rel(root, candidate)
	if err != nil || filepath.IsAbs(rel) {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// nasBackupTarget maps a slash separated archive path into root. Paths that could leave root
// (absolute, drive-relative, reserved names or ".." components) are rejected.
func nasBackupTarget(root, rel string) (string, bool) {
	rel = strings.TrimSuffix(rel, "/")
	if rel == "" || strings.ContainsRune(rel, '\\') || strings.ContainsRune(rel, 0) {
		return "", false
	}
	local := filepath.FromSlash(rel)
	if !filepath.IsLocal(local) {
		return "", false
	}
	target := filepath.Join(root, local)
	if !nasBackupInside(root, target) || target == filepath.Clean(root) {
		return "", false
	}
	return target, true
}

// nasBackupSplitEntry splits "files/<index>/<path>" archive names.
func nasBackupSplitEntry(name string) (index, rel string, ok bool) {
	const prefix = "files/"
	if !strings.HasPrefix(name, prefix) {
		return "", "", false
	}
	rest := name[len(prefix):]
	cut := strings.IndexByte(rest, '/')
	if cut <= 0 || cut == len(rest)-1 {
		return "", "", false
	}
	return rest[:cut], rest[cut+1:], true
}
