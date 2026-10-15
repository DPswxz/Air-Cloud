//go:build windows

package httpd

import (
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
)

func nasRecycleRename(oldPath, newPath string) error {
	old, err := windows.UTF16PtrFromString(oldPath)
	if err != nil {
		return err
	}
	next, err := windows.UTF16PtrFromString(newPath)
	if err != nil {
		return err
	}
	return windows.MoveFile(old, next)
}

func nasRecyclePrepare(root string) error {
	base := filepath.Dir(root)
	if err := os.MkdirAll(base, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(base)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return os.ErrPermission
	}
	sd, err := windows.SecurityDescriptorFromString("D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FA;;;LS)")
	if err != nil {
		return err
	}
	acl, _, err := sd.DACL()
	if err != nil {
		return err
	}
	if err = windows.SetNamedSecurityInfo(base, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		return err
	}
	if err = os.MkdirAll(root, 0700); err != nil {
		return err
	}
	info, err = os.Lstat(root)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return os.ErrPermission
	}
	return nil
}
