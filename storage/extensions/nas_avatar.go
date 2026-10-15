package httpd

import (
	"crypto/sha256"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/jwt"
)

var nasAvatarLock sync.Mutex

func nasAvatarPath(kind, username string) string {
	return filepath.Join(filepath.Dir(dataprovider.GetProviderConfig().BackupsPath), "avatars", fmt.Sprintf("%x.txt", sha256.Sum256([]byte(kind+":"+username))))
}

func nasAvatarChoice(kind, username string) string {
	nasAvatarLock.Lock()
	defer nasAvatarLock.Unlock()
	value, err := os.ReadFile(nasAvatarPath(kind, username))
	if err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(value))); err == nil && n >= 0 && n < 8 {
			return strconv.Itoa(n)
		}
	}
	return "0"
}

func nasAvatarURL(kind, username string) string {
	return webStaticFilesPath + "/nas-avatars/avatar-" + nasAvatarChoice(kind, username) + ".svg"
}

func (s *httpdServer) handleNASAvatar(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if r.ParseForm() != nil || verifyCSRFToken(r, s.csrfTokenAuth) != nil {
		http.Error(w, "Invalid form", 403)
		return
	}
	claims, err := jwt.FromContext(r.Context())
	if err != nil || claims.Username == "" || strings.HasPrefix(claims.Username, "__nas_admin_view_") {
		http.Error(w, "Forbidden", 403)
		return
	}
	choice, err := strconv.Atoi(r.Form.Get("avatar"))
	if err != nil || choice < 0 || choice >= 8 {
		http.Error(w, "Invalid avatar", 400)
		return
	}
	kind, target := "user", webClientProfilePath
	if claims.Audience.Contains(tokenAudienceWebAdmin) {
		kind, target = "admin", webAdminProfilePath
	}
	filename := nasAvatarPath(kind, claims.Username)
	nasAvatarLock.Lock()
	err = os.MkdirAll(filepath.Dir(filename), 0700)
	if err == nil {
		err = os.WriteFile(filename, []byte(strconv.Itoa(choice)), 0600)
	}
	nasAvatarLock.Unlock()
	if err != nil {
		http.Error(w, "Unable to save avatar", 500)
		return
	}
	http.Redirect(w, r, target+"?avatar=saved", http.StatusSeeOther)
}
