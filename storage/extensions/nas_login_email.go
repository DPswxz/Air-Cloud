package httpd

import (
	"errors"
	"strings"

	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/util"
)

// Exact usernames retain priority; an email alias must identify exactly one user.
func nasLoginUsername(identifier string) (string, error) {
	identifier = strings.TrimSpace(identifier)
	if !strings.Contains(identifier, "@") {
		return identifier, nil
	}
	if user, err := dataprovider.UserExists(identifier, ""); err == nil {
		return user.Username, nil
	} else if !errors.Is(err, util.ErrNotFound) {
		return "", err
	}
	email, err := nasRegistrationEmail(identifier)
	if err != nil {
		return identifier, nil
	}
	result := ""
	for offset := 0; ; offset += 100 {
		users, err := dataprovider.GetUsers(100, offset, "ASC", "")
		if err != nil {
			return "", err
		}
		for _, user := range users {
			if strings.EqualFold(strings.TrimSpace(user.Email), email) {
				if result != "" {
					return "", dataprovider.ErrInvalidCredentials
				}
				result = user.Username
			}
		}
		if len(users) < 100 {
			break
		}
	}
	if result == "" {
		return identifier, nil
	}
	return result, nil
}
