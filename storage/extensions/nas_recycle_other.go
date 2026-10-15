//go:build !windows && !linux

package httpd

import (
	"fmt"
	"os"
)

func nasRecycleRename(oldPath, newPath string) error {
	return fmt.Errorf("recycle is configured for Windows storage: %w", os.ErrPermission)
}

func nasRecyclePrepare(root string) error { return os.ErrPermission }
