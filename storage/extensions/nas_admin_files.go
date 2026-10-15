package httpd

import (
	"crypto/rand"
	"crypto/sha256"
	"fmt"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/jwt"
	"github.com/drakkan/sftpgo/v2/internal/util"
	"github.com/sftpgo/sdk"
)

var nasViewerLock sync.Mutex

// Only a fully authenticated global administrator may open the storage root.
// The file browser uses a separate cookie, bound to the owner's current signature.
func (s *httpdServer) handleNASAdminFiles(w http.ResponseWriter, r *http.Request) {
	claims, err := jwt.FromContext(r.Context())
	if err != nil {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	admin, err := dataprovider.AdminExists(claims.Username)
	if err != nil || admin.Status != 1 || admin.Role != "" || !admin.HasPermission(dataprovider.PermAdminAny) || admin.GetSignature() != claims.Subject || admin.CanLogin(util.GetIPFromRemoteAddress(r.RemoteAddr)) != nil {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}
	root := dataprovider.GetProviderConfig().UsersBaseDir
	if root == "" || !filepath.IsAbs(root) {
		http.Error(w, "Storage root unavailable", 500)
		return
	}
	username := fmt.Sprintf("__nas_admin_view_%x", sha256.Sum256([]byte(admin.Username)))[:33]
	nasViewerLock.Lock()
	user, err := dataprovider.UserExists(username, "")
	if err != nil {
		user.Username = username
		user.Status = 1
		user.Password = rand.Text()
		user.HomeDir = root
		user.Description = "nas-admin-view:" + admin.Username
		user.Permissions = map[string][]string{"/": {"*"}}
		user.Filters.DeniedProtocols = []string{"SSH", "FTP", "DAV"}
		user.Filters.DeniedLoginMethods = []string{dataprovider.LoginMethodPassword}
		user.Filters.WebClient = []string{sdk.WebClientPubKeyChangeDisabled, sdk.WebClientTLSCertChangeDisabled,
			sdk.WebClientMFADisabled, sdk.WebClientPasswordChangeDisabled, sdk.WebClientAPIKeyAuthChangeDisabled,
			sdk.WebClientInfoChangeDisabled, sdk.WebClientSharesDisabled, sdk.WebClientPasswordResetDisabled}
		err = dataprovider.AddUser(&user, admin.Username, util.GetIPFromRemoteAddress(r.RemoteAddr), "")
	}
	nasViewerLock.Unlock()
	if err != nil || !user.IsNASAdminFileView() || user.Description != "nas-admin-view:"+admin.Username || filepath.Clean(user.HomeDir) != filepath.Clean(root) || user.Status != 1 {
		http.Error(w, "Administrator file session unavailable", 500)
		return
	}
	token := &jwt.Claims{Username: user.Username, Permissions: user.Filters.WebClient, Role: user.Role}
	token.Subject = user.GetSignature()
	if err = createAndSetCookie(w, r, token, s.tokenAuth, tokenAudienceWebClient, util.GetIPFromRemoteAddress(r.RemoteAddr)); err != nil {
		http.Error(w, "Unable to start file session", 500)
		return
	}
	http.Redirect(w, r, webClientFilesPath, http.StatusFound)
}
