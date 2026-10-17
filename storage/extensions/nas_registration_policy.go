package httpd

import (
	"errors"
	"net/mail"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
)

var nasRegistrationUsername = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$`)

type nasRegistrationChallenge struct {
	Email    string
	Digest   [32]byte
	Expires  time.Time
	Attempts int
	Sending  bool
}
type nasRegistrationRate struct {
	Count int
	Reset time.Time
	Last  time.Time
}

var nasRegistration = struct {
	sync.Mutex
	Challenges map[string]*nasRegistrationChallenge
	Rates      map[string]nasRegistrationRate
}{Challenges: make(map[string]*nasRegistrationChallenge), Rates: make(map[string]nasRegistrationRate)}
var nasRegistrationCreate sync.Mutex

func nasRegistrationQuota() int64 {
	value, err := strconv.ParseInt(os.Getenv("NAS_REGISTRATION_QUOTA_GB"), 10, 32)
	if err != nil || value < 1 {
		value = 50
	}
	return value * 1024 * 1024 * 1024
}
func nasRegistrationEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || len(value) > 254 || strings.ContainsAny(value, "\r\n") || !strings.Contains(value, ".") {
		return "", errors.New("请输入有效的邮箱地址。")
	}
	return value, nil
}
func nasRegistrationPassword(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	letter, number := false, false
	for _, c := range value {
		letter = letter || unicode.IsLetter(c)
		number = number || unicode.IsDigit(c)
	}
	return letter && number
}

// In-memory challenges expire on restart. Never persist passwords or plaintext codes.
func nasRegistrationPrune(now time.Time) {
	for key, value := range nasRegistration.Challenges {
		if !now.Before(value.Expires) {
			delete(nasRegistration.Challenges, key)
		}
	}
	for key, value := range nasRegistration.Rates {
		if !now.Before(value.Reset) {
			delete(nasRegistration.Rates, key)
		}
	}
}
func nasRegistrationRateAllowed(ip, email string, now time.Time) bool {
	for _, item := range []struct {
		key      string
		limit    int
		cooldown time.Duration
	}{{"ip:" + ip, 10, 0}, {"email:" + email, 5, time.Minute}} {
		rate := nasRegistration.Rates[item.key]
		if now.Before(rate.Reset) && (rate.Count >= item.limit || now.Sub(rate.Last) < item.cooldown) {
			return false
		}
	}
	for _, key := range []string{"ip:" + ip, "email:" + email} {
		rate := nasRegistration.Rates[key]
		if !now.Before(rate.Reset) {
			rate = nasRegistrationRate{Reset: now.Add(time.Hour)}
		}
		rate.Count++
		rate.Last = now
		nasRegistration.Rates[key] = rate
	}
	return true
}
