package httpd

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/jwt"
)

const nasAvatarCount = 42

var nasAvatarLock sync.Mutex

func nasAvatarOptions() []string {
	result := make([]string, nasAvatarCount)
	for index := range result {
		result[index] = strconv.Itoa(index)
	}
	return result
}

func nasAvatarPath(kind, username string) string {
	return filepath.Join(filepath.Dir(dataprovider.GetProviderConfig().BackupsPath), "avatars", fmt.Sprintf("%x.txt", sha256.Sum256([]byte(kind+":"+username))))
}

func nasAvatarChoice(kind, username string) string {
	nasAvatarLock.Lock()
	defer nasAvatarLock.Unlock()
	value, err := os.ReadFile(nasAvatarPath(kind, username))
	if err == nil {
		if n, err := strconv.Atoi(strings.TrimSpace(string(value))); err == nil && n >= 0 && n < nasAvatarCount {
			return strconv.Itoa(n)
		}
	}
	if username == "" || strings.HasPrefix(username, "__nas_admin_view_") {
		return "0"
	}
	hash := sha256.Sum256([]byte(kind + ":" + username))
	fallback := strconv.Itoa(int(hash[0]) % nasAvatarCount)
	selected, err := rand.Int(rand.Reader, big.NewInt(nasAvatarCount))
	if err != nil {
		return fallback
	}
	choice := selected.String()
	filename := nasAvatarPath(kind, username)
	if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
		return fallback
	}
	if err := os.WriteFile(filename, []byte(choice), 0600); err != nil {
		return fallback
	}
	return choice
}

func nasAvatarURL(kind, username string) string {
	return webStaticFilesPath + "/nas-avatars/avatar-" + nasAvatarChoice(kind, username) + ".svg?v=20261016-grid42"
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
	if err != nil || choice < 0 || choice >= nasAvatarCount {
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
