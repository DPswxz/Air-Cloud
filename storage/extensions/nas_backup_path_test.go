package httpd

import (
	"path/filepath"
	"testing"
)

func TestNASBackupValidName(t *testing.T) {
	for _, name := range []string{"air-cloud-20261020-163000.zip", "a.zip", "backup_1-2.zip"} {
		if !nasBackupValidName(name) {
			t.Fatalf("%q must be valid", name)
		}
	}
	for _, name := range []string{"", "../a.zip", "a/b.zip", `a\b.zip`, "a.zip.part", "a.txt", ".zip", "-a.zip", "a b.zip"} {
		if nasBackupValidName(name) {
			t.Fatalf("%q must be rejected", name)
		}
	}
}

func TestNASBackupTargetStaysInsideRoot(t *testing.T) {
	root := filepath.Join(t.TempDir(), "home")
	for _, rel := range []string{"a.txt", "dir/a.txt", "dir/", "中文/文件 1.txt"} {
		target, ok := nasBackupTarget(root, rel)
		if !ok || !nasBackupInside(root, target) {
			t.Fatalf("%q must be accepted", rel)
		}
	}
	for _, rel := range []string{"", "/", "../a", "a/../../b", "/etc/passwd", `a\b`, "C:/x", "C:x", "a/..", ".."} {
		if _, ok := nasBackupTarget(root, rel); ok {
			t.Fatalf("%q must be rejected", rel)
		}
	}
}

func TestNASBackupSplitEntry(t *testing.T) {
	index, rel, ok := nasBackupSplitEntry("files/u0001/a/b.txt")
	if !ok || index != "u0001" || rel != "a/b.txt" {
		t.Fatalf("unexpected split: %q %q %v", index, rel, ok)
	}
	for _, name := range []string{"settings.json", "files/", "files//a", "files/u0001", "files/u0001/", "other/u0001/a"} {
		if _, _, ok := nasBackupSplitEntry(name); ok {
			t.Fatalf("%q must be rejected", name)
		}
	}
}
