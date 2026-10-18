package httpd

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/smtp"
	"github.com/drakkan/sftpgo/v2/internal/util"
)

const nasRegistrationPath = "/web/client/register"
const nasRegistrationCookie = "NAS_REGISTRATION"

func nasRegistrationEnabled() bool {
	return os.Getenv("NAS_REGISTRATION_ENABLED") != "false" && dataprovider.HasUsersBaseDir()
}
func nasRegistrationEmailAvailable(email string) (bool, error) {
	for offset := 0; ; offset += 100 {
		users, err := dataprovider.GetUsers(100, offset, "ASC", "")
		if err != nil {
			return false, err
		}
		for _, u := range users {
			if strings.EqualFold(strings.TrimSpace(u.Email), email) {
				return false, nil
			}
		}
		if len(users) < 100 {
			return true, nil
		}
	}
}
func nasRegistrationReply(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": status == http.StatusOK, "message": message})
}

func (s *httpdServer) handleNASRegistration(w http.ResponseWriter, r *http.Request) {
	if !nasRegistrationEnabled() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Referrer-Policy", "same-origin")
	session := rand.Text()
	http.SetCookie(w, &http.Cookie{Name: nasRegistrationCookie, Value: session, Path: nasRegistrationPath, HttpOnly: true, Secure: r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https", SameSite: http.SameSiteStrictMode, MaxAge: 1800})
	data := struct {
		CSRFToken string
		Enabled   bool
		Quota     int64
	}{createCSRFToken(w, r, s.csrfTokenAuth, rand.Text(), webBaseClientPath), smtp.IsEnabled(), nasRegistrationQuota() / 1024 / 1024 / 1024}
	_ = nasRegistrationPage.Execute(w, data)
}
func (s *httpdServer) handleNASRegistrationPost(w http.ResponseWriter, r *http.Request) {
	if !nasRegistrationEnabled() {
		http.NotFound(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if r.ParseForm() != nil || verifyLoginCookieAndCSRFToken(r, s.csrfTokenAuth) != nil {
		nasRegistrationReply(w, 403, "页面已过期，请刷新后重试。")
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		// CSRF validation above is authoritative; reject cross-site submissions too.
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			nasRegistrationReply(w, 403, "请在本站注册页面操作。")
			return
		}
	}
	cookie, err := r.Cookie(nasRegistrationCookie)
	if err != nil || len(cookie.Value) < 20 || len(cookie.Value) > 100 {
		nasRegistrationReply(w, 403, "页面已过期，请刷新后重试。")
		return
	}
	if !smtp.IsEnabled() {
		nasRegistrationReply(w, 503, "邮件服务尚未配置，请联系管理员。")
		return
	}
	email, err := nasRegistrationEmail(r.Form.Get("email"))
	if err != nil {
		nasRegistrationReply(w, 400, err.Error())
		return
	}
	session := cookie.Value
	ip := util.GetIPFromRemoteAddress(r.RemoteAddr)
	if strings.HasSuffix(r.URL.Path, "/code") {
		available, lookupErr := nasRegistrationEmailAvailable(email)
		if lookupErr != nil {
			nasRegistrationReply(w, 503, "暂时无法检查邮箱，请稍后重试。")
			return
		}
		if !available {
			nasRegistrationReply(w, 409, "邮箱已被注册，请直接登录")
			return
		}
		now := time.Now()
		nasRegistration.Lock()
		nasRegistrationPrune(now)
		if len(nasRegistration.Challenges) >= 10000 || len(nasRegistration.Rates) >= 20000 || !nasRegistrationRateAllowed(ip, email, now) {
			nasRegistration.Unlock()
			w.Header().Set("Retry-After", "60")
			nasRegistrationReply(w, 429, "发送过于频繁，请稍后再试。")
			return
		}
		if previous := nasRegistration.Challenges[session]; previous != nil && previous.Sending {
			nasRegistration.Unlock()
			nasRegistrationReply(w, 429, "验证码正在发送，请稍候。")
			return
		}
		value, err := rand.Int(rand.Reader, big.NewInt(1000000))
		if err != nil {
			nasRegistration.Unlock()
			nasRegistrationReply(w, 503, "暂时无法发送验证码，请稍后重试。")
			return
		}
		code := fmt.Sprintf("%06d", value.Int64())
		challenge := &nasRegistrationChallenge{Email: email, Digest: sha256.Sum256([]byte(session + ":" + email + ":" + code)), Expires: now.Add(10 * time.Minute), Sending: true}
		nasRegistration.Challenges[session] = challenge
		nasRegistration.Unlock()
		available, lookupErr = nasRegistrationEmailAvailable(email)
		if lookupErr != nil {
			err = lookupErr
		} else if available {
			body := fmt.Sprintf("您正在注册 Air Cloud 账号。\n\n邮箱验证码：%s\n\n验证码 10 分钟内有效，请勿向他人透露。如非本人操作，请忽略此邮件。", code)
			subject := "Air Cloud · 注册邮箱验证"
			if languageCookie, cookieErr := r.Cookie("AIR_LANGUAGE"); cookieErr == nil && languageCookie.Value == "en" {
				subject = "Air Cloud · Verify your email"
				body = fmt.Sprintf("You are creating an Air Cloud account.\n\nVerification code: %s\n\nThis code expires in 10 minutes. Do not share it. If you did not request this, ignore this email.", code)
			}
			err = smtp.SendEmail([]string{email}, nil, subject, body, smtp.EmailContentTypeTextPlain)
		}
		nasRegistration.Lock()
		if current := nasRegistration.Challenges[session]; current == challenge {
			if err != nil || !available {
				delete(nasRegistration.Challenges, session)
			} else {
				current.Sending = false
			}
		}
		nasRegistration.Unlock()
		if err != nil {
			nasRegistrationReply(w, 503, "验证码发送失败，请稍后重试或联系管理员检查邮件服务。")
			return
		}
		if !available {
			nasRegistrationReply(w, 409, "邮箱已被注册，请直接登录")
			return
		}
		nasRegistrationReply(w, 200, "验证码已发送，10 分钟内有效")
		return
	}
	username := strings.TrimSpace(r.Form.Get("username"))
	password := r.Form.Get("password")
	if !nasRegistrationUsername.MatchString(username) {
		nasRegistrationReply(w, 400, "用户名需为 3–32 位字母、数字、下划线或短横线，以字母或数字开头。")
		return
	}
	if !nasRegistrationPassword(password) {
		nasRegistrationReply(w, 400, "密码需为 8–128 位，并包含字母和数字。")
		return
	}
	if password != r.Form.Get("confirm_password") {
		nasRegistrationReply(w, 400, "两次输入的密码不一致。")
		return
	}
	nasRegistrationCreate.Lock()
	defer nasRegistrationCreate.Unlock()
	nasRegistration.Lock()
	nasRegistrationPrune(time.Now())
	challenge := nasRegistration.Challenges[session]
	if challenge == nil || challenge.Email != email || challenge.Sending || challenge.Attempts >= 5 {
		nasRegistration.Unlock()
		nasRegistrationReply(w, 400, "验证码无效或已过期，请重新获取。")
		return
	}
	challenge.Attempts++
	digest := sha256.Sum256([]byte(session + ":" + email + ":" + r.Form.Get("code")))
	if subtle.ConstantTimeCompare(challenge.Digest[:], digest[:]) != 1 {
		if challenge.Attempts >= 5 {
			delete(nasRegistration.Challenges, session)
		}
		nasRegistration.Unlock()
		nasRegistrationReply(w, 400, "验证码不正确，请检查邮件后重试。")
		return
	}
	nasRegistration.Unlock()
	if _, err := dataprovider.UserExists(username, ""); !errors.Is(err, util.ErrNotFound) {
		nasRegistrationReply(w, 409, "该用户名无法使用，请更换。")
		return
	}
	if _, err := dataprovider.AdminExists(username); !errors.Is(err, util.ErrNotFound) {
		nasRegistrationReply(w, 409, "该用户名无法使用，请更换。")
		return
	}
	available, err := nasRegistrationEmailAvailable(email)
	if err != nil {
		nasRegistrationReply(w, 503, "暂时无法创建账号，请稍后重试。")
		return
	}
	if !available {
		nasRegistrationReply(w, 409, "邮箱已被注册，请直接登录")
		return
	}
	root := dataprovider.GetProviderConfig().UsersBaseDir
	if !filepath.IsAbs(root) {
		nasRegistrationReply(w, 503, "注册目录尚未配置，请联系管理员。")
		return
	}
	if err := os.MkdirAll(root, 0700); err != nil {
		nasRegistrationReply(w, 503, "存储目录暂时不可用，请联系管理员。")
		return
	}
	home := filepath.Join(root, username)
	// Exclusive directory creation prevents a new account from inheriting old files.
	if err := os.Mkdir(home, 0700); err != nil {
		nasRegistrationReply(w, 409, "该用户名的目录无法使用，请更换用户名或联系管理员。")
		return
	}
	user := dataprovider.User{}
	user.Username = username
	user.Password = password
	user.Email = email
	user.Status = 1
	user.HomeDir = home
	user.QuotaSize = nasRegistrationQuota()
	user.Permissions = map[string][]string{"/": {"*"}}
	user.Filters.DeniedProtocols = []string{"SSH", "FTP", "DAV"}
	if err := dataprovider.AddUser(&user, "self-registration", ip, ""); err != nil {
		_ = os.Remove(home)
		nasRegistrationReply(w, 400, "账号创建失败，请检查密码是否符合服务器要求，或联系管理员。")
		return
	}
	nasRegistration.Lock()
	delete(nasRegistration.Challenges, session)
	nasRegistration.Unlock()
	_ = nasAvatarChoice("user", username)
	http.SetCookie(w, &http.Cookie{Name: nasRegistrationCookie, Path: nasRegistrationPath, MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteStrictMode})
	nasRegistrationReply(w, 200, "")
}

var nasRegistrationPage = template.Must(template.New("register").Parse(`<!doctype html>
<html lang="zh-CN"><head><script src="/static/air-i18n.js?v=20261018-i18n-audit1"></script><link rel="stylesheet" href="/static/air-i18n.css?v=20261017-language-menu1"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Air Cloud · 注册</title><link rel="icon" href="/static/air-cloud-material.svg"><script src="/static/air-auth-theme.js?v=20261016-register1"></script><link rel="stylesheet" href="/static/air-auth.css?v=20261016-register1"></head>
<body class="air-auth"><main class="air-auth-card"><a class="air-auth-brand" href="/web/client/login"><img src="/static/air-cloud-material.svg" width="44" height="44" alt=""><span>Air Cloud</span></a><h1><span data-air-i18n>创建账号</span></h1><p class="air-auth-description"><span data-air-i18n>验证邮箱，开启你的云端空间。</span></p><div class="air-auth-notice"><span data-air-i18n>独立文件空间 · 默认</span> {{.Quota}} GB</div>
<form id="air-register" action="/web/client/register" method="post"><input type="hidden" name="_form_token" value="{{.CSRFToken}}"><label for="reg-username"><span data-air-i18n>用户名</span></label><input id="reg-username" name="username" autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}" placeholder="3–32 位字母、数字、下划线或短横线" required data-air-i18n-attrs><label for="reg-email"><span data-air-i18n>邮箱</span></label><input id="reg-email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="用于验证身份和找回密码" required data-air-i18n-attrs><label for="reg-code"><span data-air-i18n>邮箱验证码</span></label><div class="air-auth-code"><input id="reg-code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 位验证码" required data-air-i18n-attrs><button class="air-auth-secondary" type="button" id="reg-send" {{if not .Enabled}}disabled{{end}}><span data-air-i18n>获取验证码</span></button></div><label for="reg-password"><span data-air-i18n>密码</span></label><input id="reg-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="至少 8 位，包含字母和数字" required data-air-i18n-attrs><label for="reg-confirm"><span data-air-i18n>确认密码</span></label><input id="reg-confirm" name="confirm_password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="再次输入密码" required data-air-i18n-attrs><div id="reg-message" class="air-auth-message" role="status" aria-live="polite" {{if .Enabled}}hidden{{end}}>{{if not .Enabled}}邮件服务尚未配置，请联系管理员后再注册。{{end}}</div><button class="air-auth-primary" id="reg-submit" {{if not .Enabled}}disabled{{end}}><span data-air-i18n>验证并注册</span></button></form><p class="air-auth-footer"><span data-air-i18n>已有账号？</span><a href="/web/client/login"><span data-air-i18n>返回登录</span></a></p><script src="/static/air-register.js?v=20261018-i18n-audit1" defer></script></main></body></html>`))
