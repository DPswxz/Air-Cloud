package httpd

import (
	"archive/zip"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/sftpgo/sdk"

	"github.com/drakkan/sftpgo/v2/internal/common"
	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/jwt"
	"github.com/drakkan/sftpgo/v2/internal/util"
)

// Administrator backup and restore. Archives are plain ZIP files stored below the backups path:
//
//	manifest.json  what the archive contains
//	settings.json  SFTPGo dump with administrators, roles, groups, folders, events, IP lists and configs
//	users.json     SFTPGo dump with the selected users, their shares and referenced groups and folders
//	avatars/...    NAS avatar choices
//	files/<id>/... the selected users' files, <id> is the index recorded in the manifest
const (
	nasBackupFormat      = "air-cloud-backup"
	nasBackupVersion     = 1
	nasBackupManifestKey = "manifest.json"
	nasBackupSettingsKey = "settings.json"
	nasBackupUsersKey    = "users.json"
	nasBackupJSONLimit   = 512 << 20
	nasBackupMaxWarnings = 100
)

// nasBackupPage follows the configured admin base path and is assigned when routes are registered.
var nasBackupPage = "/web/admin/nas-backup"

var errNASBackupCanceled = errors.New("任务已取消")

type nasBackupUserEntry struct {
	Username  string `json:"username"`
	Index     string `json:"index"`
	Info      bool   `json:"info"`
	Files     bool   `json:"files"`
	FileCount int64  `json:"fileCount"`
	FileBytes int64  `json:"fileBytes"`
	Note      string `json:"note,omitempty"`
}

type nasBackupManifest struct {
	Format    string               `json:"format"`
	Version   int                  `json:"version"`
	CreatedAt int64                `json:"createdAt"`
	CreatedBy string               `json:"createdBy"`
	Settings  bool                 `json:"settings"`
	Admins    []string             `json:"admins,omitempty"`
	Users     []nasBackupUserEntry `json:"users"`
}

type nasBackupRequest struct {
	Settings  bool     `json:"settings"`
	Users     []string `json:"users"`
	UserFiles []string `json:"userFiles"`
}

type nasRestoreRequest struct {
	Name      string   `json:"name"`
	Settings  bool     `json:"settings"`
	Users     []string `json:"users"`
	UserFiles []string `json:"userFiles"`
	InfoMode  string   `json:"infoMode"`
	FileMode  string   `json:"fileMode"`
}

// nasBackupMessage is a progress message the page can localize: Key is a template with {name} placeholders.
type nasBackupMessage struct {
	Key    string         `json:"key"`
	Values map[string]any `json:"values,omitempty"`
}

func nasBackupMsg(key string, pairs ...any) nasBackupMessage {
	message := nasBackupMessage{Key: key}
	if len(pairs) > 0 {
		message.Values = make(map[string]any, len(pairs)/2)
		for index := 0; index+1 < len(pairs); index += 2 {
			message.Values[fmt.Sprint(pairs[index])] = pairs[index+1]
		}
	}
	return message
}

func (m nasBackupMessage) String() string {
	text := m.Key
	for name, value := range m.Values {
		text = strings.ReplaceAll(text, "{"+name+"}", fmt.Sprint(value))
	}
	return text
}

type nasBackupError struct{ nasBackupMessage }

func (e nasBackupError) Error() string { return e.String() }

func nasBackupErr(key string, pairs ...any) error {
	return nasBackupError{nasBackupMsg(key, pairs...)}
}

func nasBackupSize(bytes int64) string {
	units := []string{"B", "KB", "MB", "GB", "TB"}
	value, unit := float64(bytes), 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	if unit == 0 || value >= 100 {
		return fmt.Sprintf("%.0f %s", value, units[unit])
	}
	return fmt.Sprintf("%.1f %s", value, units[unit])
}

type nasBackupJobState struct {
	ID         string             `json:"id"`
	Kind       string             `json:"kind"`
	State      string             `json:"state"`
	Phase      string             `json:"phase"`
	Current    string             `json:"current"`
	BytesDone  int64              `json:"bytesDone"`
	BytesTotal int64              `json:"bytesTotal"`
	FilesDone  int64              `json:"filesDone"`
	FilesTotal int64              `json:"filesTotal"`
	StartedAt  int64              `json:"startedAt"`
	FinishedAt int64              `json:"finishedAt"`
	Error      *nasBackupMessage  `json:"error"`
	Result     string             `json:"result"`
	Summary    []nasBackupMessage `json:"summary"`
	Warnings   []nasBackupMessage `json:"warnings"`
}

var (
	nasBackupMu     sync.Mutex
	nasBackupJob    nasBackupJobState
	nasBackupCancel atomic.Bool
	nasBackupCache  = map[string]nasBackupCached{}
)

type nasBackupCached struct {
	size     int64
	modified int64
	manifest nasBackupManifest
	err      string
}

func nasBackupDir() string {
	return filepath.Join(dataprovider.GetBackupsPath(), "air-cloud")
}

func nasBackupInternalUser(name string) bool {
	return strings.HasPrefix(name, "__nas_")
}

func nasBackupBegin(kind string) bool {
	nasBackupMu.Lock()
	defer nasBackupMu.Unlock()
	if nasBackupJob.State == "running" {
		return false
	}
	nasBackupCancel.Store(false)
	now := time.Now()
	nasBackupJob = nasBackupJobState{ID: fmt.Sprintf("%d", now.UnixNano()), Kind: kind, State: "running",
		StartedAt: now.UnixMilli(), Summary: []nasBackupMessage{}, Warnings: []nasBackupMessage{}}
	return true
}

func nasBackupUpdate(update func(*nasBackupJobState)) {
	nasBackupMu.Lock()
	update(&nasBackupJob)
	nasBackupMu.Unlock()
}

func nasBackupPhase(phase string) {
	nasBackupUpdate(func(j *nasBackupJobState) { j.Phase = phase; j.Current = "" })
}

func nasBackupWarn(key string, pairs ...any) {
	message := nasBackupMsg(key, pairs...)
	nasBackupUpdate(func(j *nasBackupJobState) {
		if len(j.Warnings) < nasBackupMaxWarnings {
			j.Warnings = append(j.Warnings, message)
		} else if len(j.Warnings) == nasBackupMaxWarnings {
			j.Warnings = append(j.Warnings, nasBackupMsg("更多警告已省略"))
		}
	})
}

func nasBackupSummary(key string, pairs ...any) {
	message := nasBackupMsg(key, pairs...)
	nasBackupUpdate(func(j *nasBackupJobState) { j.Summary = append(j.Summary, message) })
}

func nasBackupFinish(err error, result string) {
	nasBackupUpdate(func(j *nasBackupJobState) {
		j.FinishedAt = time.Now().UnixMilli()
		j.Current = ""
		switch {
		case errors.Is(err, errNASBackupCanceled):
			j.State = "canceled"
		case err != nil:
			j.State = "error"
			var known nasBackupError
			if errors.As(err, &known) {
				j.Error = &known.nasBackupMessage
			} else {
				message := nasBackupMsg("{error}", "error", err.Error())
				j.Error = &message
			}
		default:
			j.State = "done"
			j.Result = result
		}
	})
}

func nasBackupSnapshot() nasBackupJobState {
	nasBackupMu.Lock()
	defer nasBackupMu.Unlock()
	snapshot := nasBackupJob
	snapshot.Summary = append([]nasBackupMessage{}, nasBackupJob.Summary...)
	snapshot.Warnings = append([]nasBackupMessage{}, nasBackupJob.Warnings...)
	return snapshot
}

type nasBackupReader struct{ reader io.Reader }

func (r nasBackupReader) Read(p []byte) (int, error) {
	if nasBackupCancel.Load() {
		return 0, errNASBackupCanceled
	}
	n, err := r.reader.Read(p)
	if n > 0 {
		nasBackupUpdate(func(j *nasBackupJobState) { j.BytesDone += int64(n) })
	}
	return n, err
}

func nasBackupCopy(dst io.Writer, src io.Reader) (int64, error) {
	return io.CopyBuffer(dst, nasBackupReader{src}, make([]byte, 1<<20))
}

func nasBackupAdmin(r *http.Request) (executor, role string, ok bool) {
	claims, err := jwt.FromContext(r.Context())
	if err != nil {
		return "", "", false
	}
	admin, err := dataprovider.AdminExists(claims.Username)
	if err != nil || admin.Status != 1 || admin.Role != "" || !admin.HasPermission(dataprovider.PermAdminAny) ||
		admin.GetSignature() != claims.Subject || admin.CanLogin(util.GetIPFromRemoteAddress(r.RemoteAddr)) != nil {
		return "", "", false
	}
	return admin.Username, claims.Role, true
}

// Backups contain password hashes and every selected file, so only a fully authenticated global administrator may use them.
func (s *httpdServer) requireNASBackupAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, _, ok := nasBackupAdmin(r); !ok {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func nasBackupJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func nasBackupFail(w http.ResponseWriter, status int, message string) {
	nasBackupJSON(w, status, map[string]string{"error": message})
}

func (s *httpdServer) registerNASBackupRoutes(router chi.Router) {
	nasBackupPage = webBaseAdminPath + "/nas-backup"
	guarded := router.With(s.checkAuthRequirements, s.requireBuiltinLogin, s.requireNASBackupAdmin)
	changing := guarded.With(s.verifyCSRFHeader)
	guarded.With(s.refreshCookie).Get(nasBackupPage, s.handleNASBackupPage)
	guarded.Get(nasBackupPage+"/state", handleNASBackupState)
	guarded.Get(nasBackupPage+"/job", handleNASBackupJob)
	guarded.Get(nasBackupPage+"/download", handleNASBackupDownload)
	changing.Post(nasBackupPage+"/create", handleNASBackupCreate)
	changing.Post(nasBackupPage+"/restore", handleNASBackupRestore)
	changing.Post(nasBackupPage+"/cancel", handleNASBackupCancel)
	changing.Post(nasBackupPage+"/delete", handleNASBackupDelete)
	changing.Post(nasBackupPage+"/upload", handleNASBackupUpload)
}

type nasBackupPageData struct {
	basePage
	BackupURL string
}

func (s *httpdServer) handleNASBackupPage(w http.ResponseWriter, r *http.Request) {
	data := nasBackupPageData{basePage: s.getBasePageData("备份与还原", nasBackupPage, w, r), BackupURL: nasBackupPage}
	renderAdminTemplate(w, "nasbackup.html", data)
}

func loadNASBackupTemplate(templatesPath string) {
	paths := []string{
		filepath.Join(templatesPath, templateCommonDir, templateCommonBase),
		filepath.Join(templatesPath, templateAdminDir, templateBase),
		filepath.Join(templatesPath, templateAdminDir, "nasbackup.html"),
	}
	adminTemplates["nasbackup.html"] = util.LoadTemplate(nil, paths...)
}

type nasBackupUserInfo struct {
	Username    string `json:"username"`
	Status      int    `json:"status"`
	Email       string `json:"email"`
	Description string `json:"description"`
	UsedBytes   int64  `json:"usedBytes"`
	UsedFiles   int    `json:"usedFiles"`
	Local       bool   `json:"local"`
}

type nasBackupFileInfo struct {
	Name     string             `json:"name"`
	Size     int64              `json:"size"`
	Modified int64              `json:"modified"`
	Valid    bool               `json:"valid"`
	Error    string             `json:"error,omitempty"`
	Manifest *nasBackupManifest `json:"manifest,omitempty"`
}

func nasBackupListUsers() ([]nasBackupUserInfo, error) {
	result := []nasBackupUserInfo{}
	const page = 500
	for offset := 0; ; offset += page {
		users, err := dataprovider.GetUsers(page, offset, dataprovider.OrderASC, "")
		if err != nil {
			return nil, err
		}
		for _, user := range users {
			if nasBackupInternalUser(user.Username) {
				continue
			}
			result = append(result, nasBackupUserInfo{Username: user.Username, Status: user.Status, Email: user.Email,
				Description: user.Description, UsedBytes: user.UsedQuotaSize, UsedFiles: user.UsedQuotaFiles,
				Local: user.FsConfig.Provider == sdk.LocalFilesystemProvider})
		}
		if len(users) < page {
			return result, nil
		}
	}
}

func nasBackupReadManifest(path string) (nasBackupManifest, error) {
	var manifest nasBackupManifest
	zr, err := zip.OpenReader(path)
	if err != nil {
		return manifest, errors.New("不是有效的备份文件")
	}
	defer zr.Close()
	data, err := nasBackupReadEntry(&zr.Reader, nasBackupManifestKey)
	if err != nil {
		return manifest, errors.New("备份文件缺少清单")
	}
	if err = json.Unmarshal(data, &manifest); err != nil || manifest.Format != nasBackupFormat {
		return manifest, errors.New("不是 Air Cloud 备份文件")
	}
	if manifest.Version > nasBackupVersion {
		return manifest, errors.New("备份文件版本过新，请升级后再还原")
	}
	return manifest, nil
}

func nasBackupReadEntry(zr *zip.Reader, name string) ([]byte, error) {
	for _, file := range zr.File {
		if file.Name != name {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		data, err := io.ReadAll(io.LimitReader(reader, nasBackupJSONLimit))
		if err != nil {
			return nil, err
		}
		return data, nil
	}
	return nil, fs.ErrNotExist
}

func nasBackupListFiles() []nasBackupFileInfo {
	result := []nasBackupFileInfo{}
	entries, err := os.ReadDir(nasBackupDir())
	if err != nil {
		return result
	}
	for _, entry := range entries {
		if entry.IsDir() || !nasBackupValidName(entry.Name()) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		item := nasBackupFileInfo{Name: entry.Name(), Size: info.Size(), Modified: info.ModTime().UnixMilli()}
		path := filepath.Join(nasBackupDir(), entry.Name())
		nasBackupMu.Lock()
		cached, ok := nasBackupCache[path]
		nasBackupMu.Unlock()
		if !ok || cached.size != item.Size || cached.modified != item.Modified {
			manifest, err := nasBackupReadManifest(path)
			cached = nasBackupCached{size: item.Size, modified: item.Modified, manifest: manifest}
			if err != nil {
				cached.err = err.Error()
			}
			nasBackupMu.Lock()
			nasBackupCache[path] = cached
			nasBackupMu.Unlock()
		}
		if cached.err == "" {
			manifest := cached.manifest
			item.Valid, item.Manifest = true, &manifest
		} else {
			item.Error = cached.err
		}
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Modified > result[j].Modified })
	return result
}

func handleNASBackupState(w http.ResponseWriter, r *http.Request) {
	users, err := nasBackupListUsers()
	if err != nil {
		nasBackupFail(w, http.StatusInternalServerError, "无法读取用户列表")
		return
	}
	nasBackupJSON(w, http.StatusOK, map[string]any{"users": users, "backups": nasBackupListFiles(), "job": nasBackupSnapshot(),
		"directory": nasBackupDir()})
}

func handleNASBackupJob(w http.ResponseWriter, r *http.Request) {
	nasBackupJSON(w, http.StatusOK, nasBackupSnapshot())
}

func nasBackupFilePath(name string) (string, bool) {
	if !nasBackupValidName(name) {
		return "", false
	}
	return filepath.Join(nasBackupDir(), name), true
}

func handleNASBackupDownload(w http.ResponseWriter, r *http.Request) {
	path, ok := nasBackupFilePath(r.URL.Query().Get("name"))
	if !ok {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filepath.Base(path)))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), file)
}

func handleNASBackupDelete(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	var request struct {
		Name string `json:"name"`
	}
	path, ok := "", false
	if json.NewDecoder(r.Body).Decode(&request) == nil {
		path, ok = nasBackupFilePath(request.Name)
	}
	if !ok {
		nasBackupFail(w, http.StatusBadRequest, "备份名称无效")
		return
	}
	if job := nasBackupSnapshot(); job.State == "running" {
		nasBackupFail(w, http.StatusConflict, "有任务正在进行，暂时不能删除备份")
		return
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		nasBackupFail(w, http.StatusInternalServerError, "无法删除备份文件")
		return
	}
	nasBackupJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleNASBackupCancel(w http.ResponseWriter, r *http.Request) {
	nasBackupCancel.Store(true)
	nasBackupJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func handleNASBackupUpload(w http.ResponseWriter, r *http.Request) {
	if job := nasBackupSnapshot(); job.State == "running" {
		nasBackupFail(w, http.StatusConflict, "有任务正在进行，请稍后再上传")
		return
	}
	name := filepath.Base(strings.TrimSpace(r.URL.Query().Get("name")))
	if !strings.HasSuffix(strings.ToLower(name), ".zip") || !nasBackupValidName(name) {
		name = "uploaded-" + time.Now().Format("20060102-150405") + ".zip"
	}
	dir := nasBackupDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		nasBackupFail(w, http.StatusInternalServerError, "无法创建备份目录")
		return
	}
	final := filepath.Join(dir, name)
	for index := 1; ; index++ {
		if _, err := os.Stat(final); errors.Is(err, fs.ErrNotExist) {
			break
		}
		final = filepath.Join(dir, fmt.Sprintf("%s-%d.zip", strings.TrimSuffix(name, ".zip"), index))
	}
	part := final + ".part"
	out, err := os.OpenFile(part, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		nasBackupFail(w, http.StatusInternalServerError, "无法保存上传文件")
		return
	}
	_, err = io.CopyBuffer(out, r.Body, make([]byte, 1<<20))
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(part)
		nasBackupFail(w, http.StatusBadRequest, "上传中断，请重试")
		return
	}
	if _, err = nasBackupReadManifest(part); err != nil {
		_ = os.Remove(part)
		nasBackupFail(w, http.StatusBadRequest, err.Error())
		return
	}
	if err = os.Rename(part, final); err != nil {
		_ = os.Remove(part)
		nasBackupFail(w, http.StatusInternalServerError, "无法保存上传文件")
		return
	}
	nasBackupJSON(w, http.StatusOK, map[string]string{"name": filepath.Base(final)})
}

func handleNASBackupCreate(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var request nasBackupRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		nasBackupFail(w, http.StatusBadRequest, "请求无效")
		return
	}
	executor, _, _ := nasBackupAdmin(r)
	if !nasBackupBegin("backup") {
		nasBackupFail(w, http.StatusConflict, "已有备份或还原任务正在进行")
		return
	}
	go func() {
		result, err := nasRunBackup(request, executor)
		nasBackupFinish(err, result)
	}()
	nasBackupJSON(w, http.StatusAccepted, nasBackupSnapshot())
}

func handleNASBackupRestore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var request nasRestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		nasBackupFail(w, http.StatusBadRequest, "请求无效")
		return
	}
	if _, ok := nasBackupFilePath(request.Name); !ok {
		nasBackupFail(w, http.StatusBadRequest, "备份名称无效")
		return
	}
	executor, role, _ := nasBackupAdmin(r)
	ip := util.GetIPFromRemoteAddress(r.RemoteAddr)
	if !nasBackupBegin("restore") {
		nasBackupFail(w, http.StatusConflict, "已有备份或还原任务正在进行")
		return
	}
	go func() {
		err := nasRunRestore(request, executor, ip, role)
		nasBackupFinish(err, request.Name)
	}()
	nasBackupJSON(w, http.StatusAccepted, nasBackupSnapshot())
}

func nasBackupSet(names []string) map[string]bool {
	result := make(map[string]bool, len(names))
	for _, name := range names {
		result[name] = true
	}
	return result
}

func nasBackupWriteJSON(zw *zip.Writer, name string, value any) error {
	writer, err := zw.Create(name)
	if err != nil {
		return err
	}
	return json.NewEncoder(writer).Encode(value)
}

func nasBackupWriteFile(zw *zip.Writer, name, source string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	writer, err := zw.Create(name)
	if err != nil {
		return err
	}
	_, err = writer.Write(data)
	return err
}

func nasBackupAvatarEntry(kind, username string) string {
	return "avatars/" + kind + "/" + hex.EncodeToString([]byte(username))
}

func nasBackupWalk(home string, warn bool, visit func(rel string, entry fs.DirEntry) error) error {
	return filepath.WalkDir(home, func(path string, entry fs.DirEntry, err error) error {
		if nasBackupCancel.Load() {
			return errNASBackupCanceled
		}
		if err != nil {
			if path == home {
				return err
			}
			if warn {
				nasBackupWarn("无法读取 {path}：{error}", "path", path, "error", err.Error())
			}
			return nil
		}
		if path == home {
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 || (!entry.IsDir() && !entry.Type().IsRegular()) {
			return nil
		}
		rel, err := filepath.Rel(home, path)
		if err != nil {
			return nil
		}
		return visit(filepath.ToSlash(rel), entry)
	})
}

type nasBackupPlan struct {
	entry *nasBackupUserEntry
	home  string
}

func nasRunBackup(request nasBackupRequest, executor string) (result string, err error) {
	dir := nasBackupDir()
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return "", nasBackupErr("无法创建备份目录：{error}", "error", err.Error())
	}
	stamp := time.Now().Format("20060102-150405")
	name := "air-cloud-" + stamp + ".zip"
	final := filepath.Join(dir, name)
	for index := 1; ; index++ {
		if _, statErr := os.Stat(final); errors.Is(statErr, fs.ErrNotExist) {
			break
		}
		name = fmt.Sprintf("air-cloud-%s-%d.zip", stamp, index)
		final = filepath.Join(dir, name)
	}
	nasBackupPhase("读取设置与用户信息")
	dump, err := dataprovider.DumpData(nil)
	if err != nil {
		return "", nasBackupErr("无法读取数据：{error}", "error", err.Error())
	}
	users := map[string]dataprovider.User{}
	for _, user := range dump.Users {
		if !nasBackupInternalUser(user.Username) {
			users[user.Username] = user
		}
	}
	infoSet, fileSet := nasBackupSet(request.Users), nasBackupSet(request.UserFiles)
	for name := range infoSet {
		if _, ok := users[name]; !ok {
			return "", nasBackupErr("用户不存在：{name}", "name", name)
		}
	}
	for name := range fileSet {
		if _, ok := users[name]; !ok {
			return "", nasBackupErr("用户不存在：{name}", "name", name)
		}
	}
	if !request.Settings && len(infoSet) == 0 && len(fileSet) == 0 {
		return "", nasBackupErr("请至少选择一项备份内容")
	}
	selected := make([]string, 0, len(infoSet)+len(fileSet))
	for name := range users {
		if infoSet[name] || fileSet[name] {
			selected = append(selected, name)
		}
	}
	sort.Strings(selected)

	part := final + ".part"
	out, err := os.OpenFile(part, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return "", nasBackupErr("无法创建备份文件：{error}", "error", err.Error())
	}
	finished := false
	defer func() {
		if !finished {
			_ = out.Close()
			_ = os.Remove(part)
		}
	}()
	zw := zip.NewWriter(out)
	manifest := nasBackupManifest{Format: nasBackupFormat, Version: nasBackupVersion, CreatedAt: time.Now().UnixMilli(),
		CreatedBy: executor, Settings: request.Settings, Users: []nasBackupUserEntry{}}

	if request.Settings {
		nasBackupPhase("写入管理设置")
		settings := dataprovider.BackupData{Version: dump.Version, Configs: dump.Configs, IPLists: dump.IPLists, Roles: dump.Roles,
			Admins: dump.Admins, EventActions: dump.EventActions, EventRules: dump.EventRules, Groups: dump.Groups, Folders: dump.Folders}
		for _, key := range dump.APIKeys {
			if key.User == "" {
				settings.APIKeys = append(settings.APIKeys, key)
			}
		}
		if err = nasBackupWriteJSON(zw, nasBackupSettingsKey, settings); err != nil {
			return "", err
		}
		for _, admin := range dump.Admins {
			manifest.Admins = append(manifest.Admins, admin.Username)
			_ = nasBackupWriteFile(zw, nasBackupAvatarEntry("admin", admin.Username), nasAvatarPath("admin", admin.Username))
		}
		nasBackupSummary("管理设置：{count} 个管理员", "count", len(dump.Admins))
	}

	if len(infoSet) > 0 {
		nasBackupPhase("写入用户信息")
		doc := dataprovider.BackupData{Version: dump.Version}
		groups, folders := map[string]bool{}, map[string]bool{}
		for _, name := range selected {
			if !infoSet[name] {
				continue
			}
			user := users[name]
			doc.Users = append(doc.Users, user)
			for _, group := range user.Groups {
				groups[group.Name] = true
			}
			for _, folder := range user.VirtualFolders {
				folders[folder.Name] = true
			}
			_ = nasBackupWriteFile(zw, nasBackupAvatarEntry("user", name), nasAvatarPath("user", name))
		}
		for _, group := range dump.Groups {
			if groups[group.Name] {
				doc.Groups = append(doc.Groups, group)
			}
		}
		for _, folder := range dump.Folders {
			if folders[folder.Name] {
				doc.Folders = append(doc.Folders, folder)
			}
		}
		for _, share := range dump.Shares {
			if infoSet[share.Username] {
				doc.Shares = append(doc.Shares, share)
			}
		}
		for _, key := range dump.APIKeys {
			if key.User != "" && infoSet[key.User] {
				doc.APIKeys = append(doc.APIKeys, key)
			}
		}
		if err = nasBackupWriteJSON(zw, nasBackupUsersKey, doc); err != nil {
			return "", err
		}
		nasBackupSummary("用户信息：{users} 个用户，{shares} 个分享", "users", len(doc.Users), "shares", len(doc.Shares))
	}

	for index, name := range selected {
		manifest.Users = append(manifest.Users, nasBackupUserEntry{Username: name, Index: fmt.Sprintf("u%04d", index+1), Info: infoSet[name]})
	}
	plans := []nasBackupPlan{}
	if len(fileSet) > 0 {
		nasBackupPhase("统计用户文件")
		for index := range manifest.Users {
			entry := &manifest.Users[index]
			if !fileSet[entry.Username] {
				continue
			}
			user := users[entry.Username]
			home := user.GetHomeDir()
			switch {
			case user.FsConfig.Provider != sdk.LocalFilesystemProvider:
				entry.Note = "非本地存储，未备份文件"
				nasBackupWarn("用户 {name} 使用非本地存储，文件未备份", "name", entry.Username)
				continue
			case home == "":
				entry.Note = "没有主目录，未备份文件"
				continue
			}
			if info, statErr := os.Stat(home); statErr != nil || !info.IsDir() {
				entry.Note = "主目录不存在，未备份文件"
				nasBackupWarn("用户 {name} 的主目录不存在，文件未备份", "name", entry.Username)
				continue
			}
			entry.Files = true
			plans = append(plans, nasBackupPlan{entry: entry, home: home})
			nasBackupUpdate(func(j *nasBackupJobState) { j.Current = entry.Username })
			if err = nasBackupWalk(home, false, func(_ string, item fs.DirEntry) error {
				if item.IsDir() {
					return nil
				}
				info, infoErr := item.Info()
				if infoErr != nil {
					return nil
				}
				nasBackupUpdate(func(j *nasBackupJobState) { j.FilesTotal++; j.BytesTotal += info.Size() })
				return nil
			}); err != nil {
				return "", err
			}
		}
	}

	for _, plan := range plans {
		nasBackupPhase("备份用户文件")
		prefix := "files/" + plan.entry.Index + "/"
		if _, err = zw.Create(prefix); err != nil {
			return "", err
		}
		entry, home := plan.entry, plan.home
		err = nasBackupWalk(home, true, func(rel string, item fs.DirEntry) error {
			info, infoErr := item.Info()
			if infoErr != nil {
				nasBackupWarn("无法读取 {path}：{error}", "path", entry.Username+"/"+rel, "error", infoErr.Error())
				return nil
			}
			if item.IsDir() {
				_, createErr := zw.CreateHeader(&zip.FileHeader{Name: prefix + rel + "/", Method: zip.Store, Modified: info.ModTime()})
				return createErr
			}
			source, openErr := os.Open(filepath.Join(home, filepath.FromSlash(rel)))
			if openErr != nil {
				nasBackupWarn("跳过无法打开的文件 {path}：{error}", "path", entry.Username+"/"+rel, "error", openErr.Error())
				nasBackupUpdate(func(j *nasBackupJobState) { j.FilesDone++; j.BytesDone += info.Size() })
				return nil
			}
			defer source.Close()
			header, headerErr := zip.FileInfoHeader(info)
			if headerErr != nil {
				return headerErr
			}
			header.Name = prefix + rel
			header.Method = zip.Store
			writer, createErr := zw.CreateHeader(header)
			if createErr != nil {
				return createErr
			}
			nasBackupUpdate(func(j *nasBackupJobState) { j.Current = entry.Username + "/" + rel })
			written, copyErr := nasBackupCopy(writer, source)
			if copyErr != nil {
				if errors.Is(copyErr, errNASBackupCanceled) {
					return copyErr
				}
				nasBackupWarn("文件读取中断，可能不完整：{path}：{error}", "path", entry.Username+"/"+rel, "error", copyErr.Error())
			}
			entry.FileCount++
			entry.FileBytes += written
			nasBackupUpdate(func(j *nasBackupJobState) { j.FilesDone++ })
			return nil
		})
		if err != nil {
			return "", err
		}
		nasBackupSummary("用户文件 {name}：{count} 个文件，共 {size}", "name", entry.Username, "count", entry.FileCount, "size", nasBackupSize(entry.FileBytes))
	}

	nasBackupPhase("完成备份文件")
	if err = nasBackupWriteJSON(zw, nasBackupManifestKey, manifest); err != nil {
		return "", err
	}
	if err = zw.Close(); err != nil {
		return "", err
	}
	if err = out.Sync(); err != nil {
		return "", err
	}
	if err = out.Close(); err != nil {
		return "", err
	}
	if err = os.Rename(part, final); err != nil {
		return "", err
	}
	finished = true
	return name, nil
}

func nasRestoreInfo(zr *zip.Reader, selected map[string]bool, mode int, executor, ip, role string) error {
	data, err := nasBackupReadEntry(zr, nasBackupUsersKey)
	if err != nil {
		return nasBackupErr("备份中没有用户信息")
	}
	doc, err := dataprovider.ParseDumpData(data)
	if err != nil {
		return nasBackupErr("备份中的用户信息已损坏")
	}
	filtered := dataprovider.BackupData{Version: doc.Version}
	groups, folders := map[string]bool{}, map[string]bool{}
	for _, user := range doc.Users {
		if !selected[user.Username] {
			continue
		}
		filtered.Users = append(filtered.Users, user)
		for _, group := range user.Groups {
			groups[group.Name] = true
		}
		for _, folder := range user.VirtualFolders {
			folders[folder.Name] = true
		}
	}
	for _, group := range doc.Groups {
		if groups[group.Name] {
			filtered.Groups = append(filtered.Groups, group)
		}
	}
	for _, folder := range doc.Folders {
		if folders[folder.Name] {
			filtered.Folders = append(filtered.Folders, folder)
		}
	}
	for _, share := range doc.Shares {
		if selected[share.Username] {
			filtered.Shares = append(filtered.Shares, share)
		}
	}
	for _, key := range doc.APIKeys {
		if selected[key.User] {
			filtered.APIKeys = append(filtered.APIKeys, key)
		}
	}
	content, err := json.Marshal(filtered)
	if err != nil {
		return err
	}
	if err = restoreBackup(content, "", 0, mode, executor, ip, role); err != nil {
		return nasBackupErr("还原用户信息失败：{error}", "error", err.Error())
	}
	nasBackupSummary("用户信息：已处理 {users} 个用户，{shares} 个分享", "users", len(filtered.Users), "shares", len(filtered.Shares))
	return nil
}

func nasRestoreAvatars(zr *zip.Reader, settings bool, users map[string]bool, overwrite bool) {
	count := 0
	for _, file := range zr.File {
		var kind, encoded string
		switch {
		case strings.HasPrefix(file.Name, "avatars/admin/"):
			kind, encoded = "admin", strings.TrimPrefix(file.Name, "avatars/admin/")
		case strings.HasPrefix(file.Name, "avatars/user/"):
			kind, encoded = "user", strings.TrimPrefix(file.Name, "avatars/user/")
		default:
			continue
		}
		raw, err := hex.DecodeString(encoded)
		if err != nil || len(raw) == 0 {
			continue
		}
		username := string(raw)
		if (kind == "admin" && !settings) || (kind == "user" && !users[username]) {
			continue
		}
		target := nasAvatarPath(kind, username)
		if _, err = os.Stat(target); err == nil && !overwrite {
			continue
		}
		reader, err := file.Open()
		if err != nil {
			continue
		}
		data, err := io.ReadAll(io.LimitReader(reader, 64))
		_ = reader.Close()
		if err != nil {
			continue
		}
		nasAvatarLock.Lock()
		if os.MkdirAll(filepath.Dir(target), 0o700) == nil && os.WriteFile(target, data, 0o600) == nil {
			count++
		}
		nasAvatarLock.Unlock()
	}
	if count > 0 {
		nasBackupSummary("头像：已还原 {count} 个", "count", count)
	}
}

type nasRestoreTarget struct {
	username string
	realHome string
}

func nasRestoreEntry(file *zip.File, target nasRestoreTarget, rel string, overwrite bool, verified *string) (skipped bool, err error) {
	path, ok := nasBackupTarget(target.realHome, rel)
	if !ok {
		return false, nasBackupErr("备份中的路径不安全：{path}", "path", rel)
	}
	parent := path
	if !file.FileInfo().IsDir() {
		parent = filepath.Dir(path)
	}
	if parent != *verified {
		if err = os.MkdirAll(parent, 0o700); err != nil {
			return false, err
		}
		resolved, resolveErr := filepath.EvalSymlinks(parent)
		if resolveErr != nil || !nasBackupInside(target.realHome, resolved) {
			return false, nasBackupErr("目标目录不在用户主目录内：{path}", "path", rel)
		}
		*verified = parent
	}
	if file.FileInfo().IsDir() {
		return false, nil
	}
	if info, statErr := os.Lstat(path); statErr == nil {
		if info.Mode()&os.ModeSymlink != 0 || info.IsDir() {
			return true, nasBackupErr("目标已存在且不是普通文件：{path}", "path", rel)
		}
		if !overwrite {
			return true, nil
		}
	}
	source, err := file.Open()
	if err != nil {
		return false, err
	}
	defer source.Close()
	temporary := path + ".air-restore"
	perm := file.Mode().Perm()
	if perm == 0 {
		perm = 0o644
	}
	dest, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, perm)
	if err != nil {
		return false, err
	}
	if _, err = nasBackupCopy(dest, source); err != nil {
		_ = dest.Close()
		_ = os.Remove(temporary)
		return false, err
	}
	if err = dest.Close(); err != nil {
		_ = os.Remove(temporary)
		return false, err
	}
	if err = os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return false, err
	}
	if !file.Modified.IsZero() {
		_ = os.Chtimes(path, file.Modified, file.Modified)
	}
	return false, nil
}

func nasRunRestore(request nasRestoreRequest, executor, ip, role string) error {
	path, ok := nasBackupFilePath(request.Name)
	if !ok {
		return nasBackupErr("备份名称无效")
	}
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nasBackupErr("无法打开备份文件")
	}
	defer zr.Close()
	manifestData, err := nasBackupReadEntry(&zr.Reader, nasBackupManifestKey)
	if err != nil {
		return nasBackupErr("备份文件缺少清单")
	}
	var manifest nasBackupManifest
	if err = json.Unmarshal(manifestData, &manifest); err != nil || manifest.Format != nasBackupFormat {
		return nasBackupErr("不是 Air Cloud 备份文件")
	}
	entries := map[string]nasBackupUserEntry{}
	for _, entry := range manifest.Users {
		entries[entry.Username] = entry
	}
	infoSet, fileSet := nasBackupSet(request.Users), nasBackupSet(request.UserFiles)
	for name := range infoSet {
		if entry, found := entries[name]; !found || !entry.Info {
			return nasBackupErr("备份中没有用户信息：{name}", "name", name)
		}
	}
	for name := range fileSet {
		if entry, found := entries[name]; !found || !entry.Files {
			return nasBackupErr("备份中没有用户文件：{name}", "name", name)
		}
	}
	if request.Settings && !manifest.Settings {
		return nasBackupErr("备份中没有管理设置")
	}
	if !request.Settings && len(infoSet) == 0 && len(fileSet) == 0 {
		return nasBackupErr("请至少选择一项还原内容")
	}
	infoMode := 1
	if request.InfoMode == "overwrite" {
		infoMode = 0
	}
	overwriteFiles := request.FileMode == "overwrite"

	if request.Settings {
		nasBackupPhase("还原管理设置")
		data, readErr := nasBackupReadEntry(&zr.Reader, nasBackupSettingsKey)
		if readErr != nil {
			return nasBackupErr("备份中的管理设置已损坏")
		}
		if err = restoreBackup(data, "", 0, infoMode, executor, ip, role); err != nil {
			return nasBackupErr("还原管理设置失败：{error}", "error", err.Error())
		}
		nasBackupSummary("管理设置：已还原")
	}
	if len(infoSet) > 0 {
		nasBackupPhase("还原用户信息")
		if err = nasRestoreInfo(&zr.Reader, infoSet, infoMode, executor, ip, role); err != nil {
			return err
		}
	}
	nasRestoreAvatars(&zr.Reader, request.Settings, infoSet, infoMode == 0)

	targets := map[string]nasRestoreTarget{}
	for name := range fileSet {
		user, userErr := dataprovider.UserExists(name, "")
		if userErr != nil {
			nasBackupWarn("用户 {name} 不存在，文件未还原；请同时选择还原其用户信息", "name", name)
			continue
		}
		if user.FsConfig.Provider != sdk.LocalFilesystemProvider {
			nasBackupWarn("用户 {name} 使用非本地存储，文件未还原", "name", name)
			continue
		}
		home := user.GetHomeDir()
		if home == "" {
			nasBackupWarn("用户 {name} 没有主目录，文件未还原", "name", name)
			continue
		}
		if mkdirErr := os.MkdirAll(home, 0o700); mkdirErr != nil {
			nasBackupWarn("无法创建用户 {name} 的主目录：{error}", "name", name, "error", mkdirErr.Error())
			continue
		}
		realHome, resolveErr := filepath.EvalSymlinks(home)
		if resolveErr != nil {
			nasBackupWarn("无法解析用户 {name} 的主目录：{error}", "name", name, "error", resolveErr.Error())
			continue
		}
		targets[entries[name].Index] = nasRestoreTarget{username: name, realHome: realHome}
	}
	if len(targets) == 0 {
		return nil
	}
	nasBackupPhase("统计要还原的文件")
	for _, file := range zr.File {
		if index, _, found := nasBackupSplitEntry(file.Name); found {
			if _, selected := targets[index]; selected && !file.FileInfo().IsDir() {
				size := int64(file.UncompressedSize64)
				nasBackupUpdate(func(j *nasBackupJobState) { j.FilesTotal++; j.BytesTotal += size })
			}
		}
	}
	nasBackupPhase("还原用户文件")
	counts := map[string][2]int64{}
	verified, lastIndex := "", ""
	for _, file := range zr.File {
		if nasBackupCancel.Load() {
			return errNASBackupCanceled
		}
		index, rel, found := nasBackupSplitEntry(file.Name)
		if !found {
			continue
		}
		target, selected := targets[index]
		if !selected {
			continue
		}
		if index != lastIndex {
			verified, lastIndex = "", index
		}
		isDir := file.FileInfo().IsDir()
		if !isDir {
			nasBackupUpdate(func(j *nasBackupJobState) { j.Current = target.username + "/" + rel })
		}
		skipped, entryErr := nasRestoreEntry(file, target, rel, overwriteFiles, &verified)
		if errors.Is(entryErr, errNASBackupCanceled) {
			return entryErr
		}
		if entryErr != nil {
			nasBackupWarn("{path}：{error}", "path", target.username+"/"+rel, "error", entryErr.Error())
		}
		if isDir {
			continue
		}
		count := counts[target.username]
		if !skipped && entryErr == nil {
			count[0]++
		} else {
			count[1]++
		}
		counts[target.username] = count
		size := int64(file.UncompressedSize64)
		failed := skipped || entryErr != nil
		nasBackupUpdate(func(j *nasBackupJobState) {
			j.FilesDone++
			if failed {
				j.BytesDone += size
			}
		})
	}
	names := make([]string, 0, len(counts))
	for name := range counts {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		nasBackupSummary("用户文件 {name}：还原 {done} 个，跳过或失败 {skipped} 个", "name", name, "done", counts[name][0], "skipped", counts[name][1])
		if user, userErr := dataprovider.GetUserWithGroupSettings(name, ""); userErr == nil && common.QuotaScans.AddUserQuotaScan(user.Username, user.Role) {
			go func() { _ = doUserQuotaScan(&user) }()
		}
	}
	return nil
}
