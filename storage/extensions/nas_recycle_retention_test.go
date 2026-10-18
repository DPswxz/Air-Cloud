package httpd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNASRecycleRetentionFixed(t *testing.T) {
	root := t.TempDir()
	for _, settings := range []string{"", "{\"days\":30}", "{\"days\":7}", "{\"days\":365}"} {
		if err := os.WriteFile(filepath.Join(root, "settings.json"), []byte(settings), 0600); err != nil {
			t.Fatal(err)
		}
		if got := nasRecycleDays(root); got != 7 {
			t.Fatalf("retention=%d; want 7", got)
		}
	}
}
