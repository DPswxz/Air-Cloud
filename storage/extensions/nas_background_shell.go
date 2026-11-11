package httpd

import (
	"html"
	"net/http"
	"strings"

	"github.com/drakkan/sftpgo/v2/internal/common"
)

func (s *httpdServer) showNASBackgroundShell(w http.ResponseWriter, r *http.Request) bool {
	isDocument := r.Header.Get("Sec-Fetch-Dest") == "document" ||
		(r.Header.Get("Sec-Fetch-Dest") == "" && strings.Contains(r.Header.Get("Accept"), "text/html") && r.Header.Get("X-Requested-With") == "")
	if r.URL.Query().Get("air_raw") == "1" || r.URL.Query().Get("air_frame") == "1" || r.URL.Query().Get("progress_id") != "" || !isDocument {
		return false
	}
	conn, err := getUserConnection(w, r)
	if err != nil {
		return true
	}
	defer common.Connections.Remove(conn.GetID())
	name := conn.User.GetCleanedPath(r.URL.Query().Get("path"))
	if name != "/" {
		info, err := conn.Stat(name, 1)
		if err != nil || !info.IsDir() {
			return false
		}
	}
	query := r.URL.Query()
	query.Set("air_frame", "1")
	frameURL := r.URL.Path + "?" + query.Encode()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write([]byte(`<!doctype html><html lang="zh-CN"><head><script>(function(){try{let t=localStorage.getItem('data-bs-theme-mode')||localStorage.getItem('data-bs-theme')||'system';if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';const r=document.documentElement;r.dataset.bsTheme=t;r.style.colorScheme=t;r.style.backgroundColor=t==='dark'?'#101827':'#f4f7fc'}catch{}})();</script><style>html[data-bs-theme=dark],html[data-bs-theme=dark] body{background:#101827!important;color-scheme:dark}html[data-bs-theme=light],html[data-bs-theme=light] body{background:#f4f7fc;color-scheme:light}</style><script src="/static/air-auth-theme.js?v=20261019-header3"></script><script src="/static/air-i18n.js?v=20261111-resume7"></script><link rel="stylesheet" href="/static/air-i18n.css?v=20261017-language-menu1"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Air Cloud</title><link rel="icon" href="` + webStaticFilesPath + `/air-cloud.svg"><link rel="stylesheet" href="` + webStaticFilesPath + `/nas-ui.css?v=20261022-navigation-theme18"><style>html,body{margin:0;height:100%;overflow:hidden}#air-main-frame{border:0;display:block;width:100%;height:100dvh;background:inherit;color-scheme:inherit}</style></head><body><iframe id="air-main-frame" title="Air Cloud 网盘" data-air-i18n-attrs src="` + html.EscapeString(frameURL) + `" allow="filesystem-access"></iframe><script src="` + webStaticFilesPath + `/air-navigation.js?v=20261016-en2"></script><script src="` + webStaticFilesPath + `/air-background.js?v=20261111-resume7"></script><script src="` + webStaticFilesPath + `/air-page-preload.js?v=20261022-theme18"></script></body></html>`))
	return true
}
