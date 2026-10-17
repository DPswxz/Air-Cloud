package httpd

import (
	"testing"
	"time"
)

func TestNASRegistrationInput(t *testing.T) {
	for _, value := range []string{"../admin", "__nas_admin_view_test", "ab", "a/b", "name@example.com", " spaced"} {
		if nasRegistrationUsername.MatchString(value) {
			t.Fatalf("unsafe username accepted: %q", value)
		}
	}
	if !nasRegistrationUsername.MatchString("user_123-name") {
		t.Fatal("valid username rejected")
	}
	for _, value := range []string{"short1", "abcdefgh", "123456789", "abc\n@example.com", "Name <mail@example.com>"} {
		if value == "abc\n@example.com" || value == "Name <mail@example.com>" {
			if _, err := nasRegistrationEmail(value); err == nil {
				t.Fatalf("invalid email accepted: %q", value)
			}
		} else if nasRegistrationPassword(value) {
			t.Fatalf("weak password accepted: %q", value)
		}
	}
	if !nasRegistrationPassword("A-good-password-8") {
		t.Fatal("valid password rejected")
	}
	if value, err := nasRegistrationEmail(" USER@Example.com "); err != nil || value != "user@example.com" {
		t.Fatal("email normalization failed")
	}
}
func TestNASRegistrationOutlook(t *testing.T) {
	value, err := nasRegistrationEmail("Outlook-Test@outlook.com")
	if err != nil || value != "outlook-test@outlook.com" {
		t.Fatal("Outlook address was changed")
	}
}

func TestNASRegistrationLimits(t *testing.T) {
	nasRegistration.Lock()
	defer nasRegistration.Unlock()
	nasRegistration.Challenges = make(map[string]*nasRegistrationChallenge)
	nasRegistration.Rates = make(map[string]nasRegistrationRate)
	defer func() {
		nasRegistration.Challenges = make(map[string]*nasRegistrationChallenge)
		nasRegistration.Rates = make(map[string]nasRegistrationRate)
	}()
	now := time.Now()
	if !nasRegistrationRateAllowed("ip1", "email1", now) {
		t.Fatal("first send denied")
	}
	if nasRegistrationRateAllowed("ip2", "email1", now.Add(59*time.Second)) {
		t.Fatal("email cooldown bypassed")
	}
	if !nasRegistrationRateAllowed("ip1", "email1", now.Add(time.Minute)) {
		t.Fatal("resend denied after cooldown")
	}
	for i := 0; i < 8; i++ {
		if !nasRegistrationRateAllowed("ip1", string(rune('a'+i)), now.Add(2*time.Minute)) {
			t.Fatal("unexpected rate limit")
		}
	}
	if nasRegistrationRateAllowed("ip1", "new", now.Add(3*time.Minute)) {
		t.Fatal("IP limit bypassed")
	}
	if !nasRegistrationRateAllowed("ip1", "new", now.Add(61*time.Minute)) {
		t.Fatal("hourly limit did not reset")
	}
	nasRegistration.Challenges["expired"] = &nasRegistrationChallenge{Expires: now.Add(-time.Second)}
	nasRegistration.Challenges["valid"] = &nasRegistrationChallenge{Expires: now.Add(time.Minute)}
	nasRegistrationPrune(now)
	if nasRegistration.Challenges["expired"] != nil || nasRegistration.Challenges["valid"] == nil {
		t.Fatal("challenge expiration failed")
	}
}
