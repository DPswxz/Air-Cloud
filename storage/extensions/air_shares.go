package httpd

import (
	"errors"
	"net/http"
	"path"
	"regexp"
	"strings"

	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/util"
)

var airShareIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

func airAssignShareID(share *dataprovider.Share, r *http.Request) error {
	id := strings.TrimSpace(r.Form.Get("custom_id"))
	if id == "" {
		share.ShareID = util.GenerateUniqueID()
		return nil
	}
	share.ShareID = id
	if !airShareIDPattern.MatchString(id) {
		return errors.New("分享后缀只能使用 1–64 位字母、数字、下划线或短横线")
	}
	switch strings.ToLower(id) {
	case "web", "api", "static", "healthz", "nas-login", "lan-check", "forgot-password", "speedtest":
		return errors.New("这个分享后缀已被占用，请换一个")
	}
	_, err := dataprovider.ShareExists(id, "")
	if err == nil {
		return errors.New("这个分享后缀已被占用，请换一个")
	}
	if getRespStatus(err) != http.StatusNotFound {
		return errors.New("暂时无法检查分享后缀，请稍后重试")
	}
	return nil
}

func airShareCreationError(err error, r *http.Request) *util.I18nError {
	if strings.TrimSpace(r.Form.Get("custom_id")) != "" && getRespStatus(err) == http.StatusConflict {
		return util.NewI18nError(err, "这个分享后缀已被占用，请换一个")
	}
	return util.NewI18nError(err, util.I18nErrorShareGeneric)
}

// This entry always checks password, expiry, owner status, IP and download limits.
// The directory view reads the original filesystem; no snapshot is created.
func (s *httpdServer) handleAirSharePage(w http.ResponseWriter, r *http.Request) {
	share, connection, err := s.checkPublicShare(w, r, []dataprovider.ShareScope{dataprovider.ShareScopeRead, dataprovider.ShareScopeReadWrite})
	if err != nil {
		return
	}
	defer connection.CloseFS()
	w.Header().Set("Cache-Control", "no-store")
	if len(share.Paths) == 1 {
		info, statErr := connection.Stat(share.Paths[0], 0)
		if statErr == nil && info.IsDir() {
			s.renderSharedFilesPage(w, r, "/", nil, share)
			return
		}
	}
	// Existing native download endpoints remain compatible with old links.
	s.renderShareDownloadPage(w, r, &share, path.Join(webClientPubSharesPath, share.ShareID)+"?compress=false")
}
