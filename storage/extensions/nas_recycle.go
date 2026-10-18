package httpd

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/drakkan/sftpgo/v2/internal/common"
	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/vfs"
)

var nasRecycleMu sync.Mutex

const nasRecycleDir = ".air-recycle"

type nasRecycleEntry struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Original  string `json:"original"`
	DeletedAt int64  `json:"deleted_at"`
	Bytes     int64  `json:"bytes"`
	Files     int    `json:"files"`
	Directory bool   `json:"directory"`
}

func nasRecycleRoot(u *dataprovider.User) string {
	hash := sha256.Sum256([]byte(u.Username))
	return filepath.Join(filepath.Dir(dataprovider.GetProviderConfig().UsersBaseDir), nasRecycleDir, hex.EncodeToString(hash[:16]))
}
func nasRecycleDays(_ string) int {
	return 7
}
func nasRecycleID(id string) bool {
	b, e := hex.DecodeString(id)
	return e == nil && len(b) == 16 && strings.ToLower(id) == id
}
func nasRecycleRead(root, id string) (nasRecycleEntry, error) {
	var item nasRecycleEntry
	if !nasRecycleID(id) {
		return item, os.ErrPermission
	}
	dir := filepath.Join(root, id)
	info, err := os.Lstat(dir)
	if err != nil {
		return item, err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return item, os.ErrPermission
	}
	data, err := os.ReadFile(filepath.Join(dir, "entry.json"))
	if err != nil {
		return item, err
	}
	if json.Unmarshal(data, &item) != nil || item.ID != id || item.Original == "/" || path.Clean(item.Original) != item.Original || !strings.HasPrefix(item.Original, "/") {
		return item, os.ErrPermission
	}
	_, err = os.Lstat(filepath.Join(dir, "payload"))
	return item, err
}
func nasRecycleItems(root string) []nasRecycleEntry {
	result := make([]nasRecycleEntry, 0)
	entries, _ := os.ReadDir(root)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		item, err := nasRecycleRead(root, entry.Name())
		if err == nil {
			result = append(result, item)
		}
	}
	sort.Slice(result, func(i, j int) bool { return result[i].DeletedAt > result[j].DeletedAt })
	return result
}
func nasRecyclePurge(root, id string) error {
	if _, err := nasRecycleRead(root, id); err != nil {
		return err
	}
	dir := filepath.Join(root, id)
	if err := os.RemoveAll(filepath.Join(dir, "payload")); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dir, "entry.json")); err != nil {
		return err
	}
	return os.Remove(dir)
}
func nasRecycleExpired(root string) {
	cutoff := time.Now().Add(-time.Duration(nasRecycleDays(root)) * 24 * time.Hour).UnixMilli()
	for _, item := range nasRecycleItems(root) {
		if item.DeletedAt <= cutoff {
			_ = nasRecyclePurge(root, item.ID)
		}
	}
}

// Never follow filesystem links while selecting or restoring a physical user path.
func nasRecycleSafeHome(home, physical string) error {
	absHome, err := filepath.Abs(home)
	if err != nil {
		return err
	}
	absPath, err := filepath.Abs(physical)
	if err != nil {
		return err
	}
	rel, err := filepath.Rel(absHome, absPath)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return os.ErrPermission
	}
	current := absHome
	info, err := os.Lstat(current)
	if err != nil || info.Mode()&os.ModeSymlink != 0 {
		return os.ErrPermission
	}
	for _, part := range strings.Split(filepath.Dir(rel), string(os.PathSeparator)) {
		if part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err = os.Lstat(current)
		if os.IsNotExist(err) {
			break
		}
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return os.ErrPermission
		}
	}
	return nil
}
func nasRecycleMove(c *Connection, name string) error {
	nasRecycleMu.Lock()
	defer nasRecycleMu.Unlock()
	fs, physical, err := c.GetFsAndResolvedPath(name)
	if err != nil {
		return err
	}
	if _, ok := fs.(*vfs.OsFs); !ok {
		return fmt.Errorf("recycle requires local storage: %w", os.ErrPermission)
	}
	info, err := os.Lstat(physical)
	if err != nil {
		return err
	}
	if name == "/" {
		return os.ErrPermission
	}
	owner := c.User
	original := name
	if owner.IsNASAdminFileView() {
		parts := strings.SplitN(strings.TrimPrefix(name, "/"), "/", 2)
		if len(parts) != 2 || parts[0] == nasRecycleDir {
			return os.ErrPermission
		}
		owner, err = dataprovider.GetUserWithGroupSettings(parts[0], "")
		if err != nil {
			return os.ErrPermission
		}
		original = "/" + parts[1]
	}
	if err = nasRecycleSafeHome(owner.HomeDir, physical); err != nil {
		return err
	}
	item := nasRecycleEntry{Name: path.Base(original), Original: original, DeletedAt: time.Now().UnixMilli(), Directory: info.IsDir()}
	err = filepath.WalkDir(physical, func(p string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, _ := filepath.Rel(physical, p)
		virtual := name
		if rel != "." {
			virtual = path.Join(name, filepath.ToSlash(rel))
		}
		if d.IsDir() {
			if err := c.IsRemoveDirAllowed(fs, p, virtual); err != nil {
				return err
			}
		} else {
			if err := c.IsRemoveFileAllowed(virtual); err != nil {
				return err
			}
			if d.Type()&os.ModeSymlink == 0 {
				f, e := d.Info()
				if e != nil {
					return e
				}
				item.Files++
				item.Bytes += f.Size()
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	root := nasRecycleRoot(&owner)
	if err = nasRecyclePrepare(root); err != nil {
		return err
	}
	nasRecycleExpired(root)
	raw := make([]byte, 16)
	if _, err = rand.Read(raw); err != nil {
		return err
	}
	item.ID = hex.EncodeToString(raw)
	dir := filepath.Join(root, item.ID)
	if err = os.Mkdir(dir, 0700); err != nil {
		return err
	}
	data, _ := json.Marshal(item)
	if err = os.WriteFile(filepath.Join(dir, "entry.json"), data, 0600); err != nil {
		_ = os.Remove(dir)
		return err
	}
	if err = nasRecycleRename(physical, filepath.Join(dir, "payload")); err != nil {
		_ = os.Remove(filepath.Join(dir, "entry.json"))
		_ = os.Remove(dir)
		return err
	}
	if err = dataprovider.UpdateUserQuota(&owner, -item.Files, -item.Bytes, false); err != nil {
		_ = nasRecycleRename(filepath.Join(dir, "payload"), physical)
		return err
	}
	return nil
}
func handleNASRecycle(w http.ResponseWriter, r *http.Request) {
	c, err := getUserConnection(w, r)
	if err != nil {
		return
	}
	defer common.Connections.Remove(c.GetID())
	if c.User.IsNASAdminFileView() {
		sendAPIResponse(w, r, nil, "请使用个人账号管理回收站", http.StatusForbidden)
		return
	}
	nasRecycleMu.Lock()
	defer nasRecycleMu.Unlock()
	root := nasRecycleRoot(&c.User)
	nasRecycleExpired(root)
	if r.Method == http.MethodGet {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Query().Has("id") {
			id := r.URL.Query().Get("id")
			item, readErr := nasRecycleRead(root, id)
			if readErr != nil || !item.Directory {
				sendAPIResponse(w, r, nil, "回收站文件夹不存在", http.StatusNotFound)
				return
			}
			offset := 0
			if value := r.URL.Query().Get("offset"); value != "" {
				var parseErr error
				offset, parseErr = strconv.Atoi(value)
				if parseErr != nil {
					sendAPIResponse(w, r, nil, "请求无效", http.StatusBadRequest)
					return
				}
			}
			page, browseErr := nasRecycleChildren(filepath.Join(root, id, "payload"), r.URL.Query().Get("path"), offset)
			if browseErr != nil {
				status := http.StatusInternalServerError
				if errors.Is(browseErr, os.ErrPermission) {
					status = http.StatusForbidden
				} else if errors.Is(browseErr, os.ErrNotExist) {
					status = http.StatusNotFound
				}
				sendAPIResponse(w, r, nil, "无法读取回收站文件夹", status)
				return
			}
			json.NewEncoder(w).Encode(page)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"days": nasRecycleDays(root), "items": nasRecycleItems(root)})
		return
	}
	var req struct {
		Action string `json:"action"`
		ID     string `json:"id"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		sendAPIResponse(w, r, nil, "请求无效", 400)
		return
	}
	switch req.Action {
	case "settings":
		sendAPIResponse(w, r, nil, "Retention is fixed at 7 days", http.StatusBadRequest)
		return
	case "restore":
		var item nasRecycleEntry
		item, err = nasRecycleRead(root, req.ID)
		if err != nil {
			break
		}
		fs, target, e := c.GetFsAndResolvedPath(item.Original)
		if e != nil {
			err = e
			break
		}
		if _, ok := fs.(*vfs.OsFs); !ok {
			err = os.ErrPermission
			break
		}
		if err = nasRecycleSafeHome(c.User.HomeDir, target); err != nil {
			break
		}
		permission := dataprovider.PermUpload
		if item.Directory {
			permission = dataprovider.PermCreateDirs
		}
		if !c.User.HasPerm(permission, path.Dir(item.Original)) {
			err = os.ErrPermission
			break
		}
		payloadRoot := filepath.Join(root, req.ID, "payload")
		err = filepath.WalkDir(payloadRoot, func(current string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			rel, e := filepath.Rel(payloadRoot, current)
			if e != nil {
				return e
			}
			virtual := path.Join(item.Original, filepath.ToSlash(rel))
			perm := dataprovider.PermUpload
			if entry.IsDir() {
				perm = dataprovider.PermCreateDirs
			}
			if !c.User.HasPerm(perm, path.Dir(virtual)) {
				return os.ErrPermission
			}
			if allowed, _ := c.User.IsFileAllowed(virtual); !allowed {
				return os.ErrPermission
			}
			resolvedFS, resolved, e := c.GetFsAndResolvedPath(virtual)
			if e != nil {
				return e
			}
			if _, local := resolvedFS.(*vfs.OsFs); !local {
				return os.ErrPermission
			}
			expected := filepath.Join(target, rel)
			if filepath.Clean(resolved) != filepath.Clean(expected) {
				return os.ErrPermission
			}
			return nil
		})
		if err != nil {
			break
		}
		if _, e = os.Lstat(target); !os.IsNotExist(e) {
			sendAPIResponse(w, r, nil, "原位置已存在同名项目，请先重命名或移走，恢复不会覆盖文件。", http.StatusConflict)
			return
		}
		files, bytes, _, _, e := dataprovider.GetUsedQuota(c.User.Username)
		if e != nil {
			err = e
			break
		}
		if (c.User.QuotaSize > 0 && bytes+item.Bytes > c.User.QuotaSize) || (c.User.QuotaFiles > 0 && files+item.Files > c.User.QuotaFiles) {
			sendAPIResponse(w, r, nil, "空间或文件配额不足，无法恢复。", 409)
			return
		}
		missing := path.Dir(item.Original)
		for missing != "/" {
			candidate := filepath.Join(c.User.HomeDir, filepath.FromSlash(strings.TrimPrefix(missing, "/")))
			if _, e := os.Lstat(candidate); e == nil {
				break
			}
			if !c.User.HasPerm(dataprovider.PermCreateDirs, path.Dir(missing)) {
				err = os.ErrPermission
				break
			}
			missing = path.Dir(missing)
		}
		if err != nil {
			break
		}
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			break
		}
		payload := filepath.Join(root, req.ID, "payload")
		err = nasRecycleRename(payload, target)
		if err == nil {
			err = dataprovider.UpdateUserQuota(&c.User, item.Files, item.Bytes, false)
			if err != nil {
				_ = nasRecycleRename(target, payload)
			} else {
				_ = os.Remove(filepath.Join(root, req.ID, "entry.json"))
				_ = os.Remove(filepath.Join(root, req.ID))
			}
		}
	case "purge":
		err = nasRecyclePurge(root, req.ID)
	case "empty":
		for _, item := range nasRecycleItems(root) {
			if err = nasRecyclePurge(root, item.ID); err != nil {
				break
			}
		}
	default:
		sendAPIResponse(w, r, nil, "操作无效", 400)
		return
	}
	if err != nil {
		status := 500
		if errors.Is(err, os.ErrPermission) {
			status = 403
		}
		if errors.Is(err, os.ErrNotExist) {
			status = 404
		}
		sendAPIResponse(w, r, nil, "操作失败，请检查权限或稍后重试。", status)
		return
	}
	sendAPIResponse(w, r, nil, "已完成", 200)
}
func init() {
	go func() {
		time.Sleep(time.Minute)
		for {
			for offset := 0; ; offset += 100 {
				users, err := dataprovider.GetUsers(100, offset, "ASC", "")
				if err != nil || len(users) == 0 {
					break
				}
				for _, u := range users {
					if u.IsNASAdminFileView() {
						continue
					}
					nasRecycleMu.Lock()
					nasRecycleExpired(nasRecycleRoot(&u))
					nasRecycleMu.Unlock()
				}
				if len(users) < 100 {
					break
				}
			}
			time.Sleep(time.Hour)
		}
	}()
}
