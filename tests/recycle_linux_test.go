//go:build linux

package httpd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRecycleRenameNeverOverwrites(t *testing.T) {
	root := t.TempDir()
	old, next := filepath.Join(root, "old"), filepath.Join(root, "next")
	os.WriteFile(old, []byte("original"), 0600)
	os.WriteFile(next, []byte("existing"), 0600)
	if err := nasRecycleRename(old, next); err == nil {
		t.Fatal("overwrote an existing destination")
	}
	data, _ := os.ReadFile(next)
	if string(data) != "existing" {
		t.Fatal("destination changed")
	}
	if err := os.Remove(next); err != nil {
		t.Fatal(err)
	}
	if err := nasRecycleRename(old, next); err != nil {
		t.Fatal(err)
	}
	data, _ = os.ReadFile(next)
	if string(data) != "original" {
		t.Fatal("payload changed")
	}
}

func TestRecyclePrivateDirectoryRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	base := filepath.Join(root, ".air-recycle")
	if err := os.Symlink(t.TempDir(), base); err != nil {
		t.Fatal(err)
	}
	if err := nasRecyclePrepare(filepath.Join(base, "user")); err == nil {
		t.Fatal("followed a symlink")
	}
	os.Remove(base)
	if err := nasRecyclePrepare(filepath.Join(base, "user")); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(base)
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatal("recycle directory must be private")
	}
}
