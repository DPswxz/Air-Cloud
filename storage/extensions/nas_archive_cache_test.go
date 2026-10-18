package httpd

import (
	"os"
	"path/filepath"
	"testing"
)

func nasTestFree(value int64) func() (int64, error) {
	return func() (int64, error) { return value, nil }
}

func TestNASArchiveBudget(t *testing.T) {
	root := t.TempDir()
	a, b := filepath.Join(root, "a"), filepath.Join(root, "b")
	for _, dir := range []string{a, b} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	budget := nasArchiveCacheBudget{active: make(map[string]nasArchiveReservation), globalLimit: 100, ownerLimit: 70, fileLimit: 60, diskMargin: 10}
	limit, release, err := budget.acquire(root, a, filepath.Join(a, "first.part"), nasTestFree(1000))
	if err != nil || limit != 60 {
		t.Fatalf("first reservation: %d %v", limit, err)
	}
	defer release()
	limit, other, err := budget.acquire(root, b, filepath.Join(b, "second.part"), nasTestFree(1000))
	if err != nil || limit != 40 {
		t.Fatalf("global budget: %d %v", limit, err)
	}
	if _, _, err = budget.acquire(root, a, filepath.Join(a, "third.part"), nasTestFree(1000)); err == nil {
		t.Fatal("concurrent jobs exceeded global quota")
	}
	other()
	other() // release is safe when error cleanup runs twice
	limit, other, err = budget.acquire(root, a, filepath.Join(a, "third.part"), nasTestFree(1000))
	if err != nil || limit != 10 {
		t.Fatalf("owner budget: %d %v", limit, err)
	}
	other()
}

func TestNASArchiveBudgetRetainedFilesAndDiskReserve(t *testing.T) {
	root := t.TempDir()
	owner := filepath.Join(root, "owner")
	if err := os.Mkdir(owner, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(owner, "old.zip"), make([]byte, 30), 0600); err != nil {
		t.Fatal(err)
	}
	budget := nasArchiveCacheBudget{active: make(map[string]nasArchiveReservation), globalLimit: 100, ownerLimit: 70, fileLimit: 60, diskMargin: 10}
	part := filepath.Join(owner, "new.part")
	limit, release, err := budget.acquire(root, owner, part, nasTestFree(35))
	if err != nil || limit != 25 {
		t.Fatalf("disk reserve: %d %v", limit, err)
	}
	if err := os.WriteFile(part, make([]byte, 10), 0600); err != nil {
		t.Fatal(err)
	}
	// Ten reserved bytes are now on disk: do not count those bytes twice.
	limit, second, err := budget.acquire(root, owner, filepath.Join(owner, "second.part"), nasTestFree(25))
	if err == nil {
		second()
		t.Fatalf("disk margin was consumed: %d", limit)
	}
	release()
	limit, second, err = budget.acquire(root, owner, filepath.Join(owner, "second.part"), nasTestFree(1000))
	if err != nil || limit != 30 {
		t.Fatalf("retained .zip and .part accounting: %d %v", limit, err)
	}
	second()
}
