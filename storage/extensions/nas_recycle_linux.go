//go:build linux

package httpd

import (
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
)

// RENAME_NOREPLACE closes the restore conflict race and never replaces a file.
// Cross-device moves fail rather than falling back to a destructive copy/delete.
func nasRecycleRename(oldPath, newPath string) error {
	return unix.Renameat2(unix.AT_FDCWD, oldPath, unix.AT_FDCWD, newPath, unix.RENAME_NOREPLACE)
}

func nasRecyclePrepare(root string) error {
	base := filepath.Dir(root)
	for _, dir := range []string{base, root} {
		if err := os.Mkdir(dir, 0700); err != nil && !os.IsExist(err) {
			return err
		}
		info, err := os.Lstat(dir)
		if err != nil {
			return err
		}
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return os.ErrPermission
		}
		if err := os.Chmod(dir, 0700); err != nil {
			return err
		}
	}
	return nil
}
