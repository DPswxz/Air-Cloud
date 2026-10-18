package httpd

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type nasArchiveReservation struct {
	owner string
	limit int64
}

// Reserve a bounded allowance before starting a writer. Active .part files are
// represented by their reservation, so concurrent jobs cannot spend it twice.
type nasArchiveCacheBudget struct {
	sync.Mutex
	active                                         map[string]nasArchiveReservation
	globalLimit, ownerLimit, fileLimit, diskMargin int64
}

var nasArchiveCache = nasArchiveCacheBudget{
	active:      make(map[string]nasArchiveReservation),
	globalLimit: 64 << 30, ownerLimit: 32 << 30,
	fileLimit: 16 << 30, diskMargin: 512 << 20,
}

func (b *nasArchiveCacheBudget) acquire(root, owner, part string, available func() (int64, error)) (int64, func(), error) {
	b.Lock()
	defer b.Unlock()
	var total, owned, pendingDisk int64
	count := 0
	for file, reservation := range b.active {
		total += reservation.limit
		pendingDisk += reservation.limit
		if info, err := os.Stat(file); err == nil {
			pendingDisk -= min(info.Size(), reservation.limit)
		}
		if reservation.owner == owner {
			owned += reservation.limit
			count++
		}
	}
	err := filepath.WalkDir(root, func(file string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || (!strings.HasSuffix(file, ".zip") && !strings.HasSuffix(file, ".part")) {
			return nil
		}
		if _, active := b.active[file]; active {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		if filepath.Dir(file) == owner {
			owned += info.Size()
			count++
		}
		return nil
	})
	if err != nil {
		return 0, nil, err
	}
	free, err := available()
	if err != nil {
		return 0, nil, err
	}
	limit := min(b.fileLimit, b.globalLimit-total, b.ownerLimit-owned, free-pendingDisk-b.diskMargin)
	if count >= 16 || limit <= 0 {
		return 0, nil, errors.New("temporary archive quota or disk reserve exhausted")
	}
	if _, exists := b.active[part]; exists {
		return 0, nil, errors.New("archive already reserved")
	}
	b.active[part] = nasArchiveReservation{owner: owner, limit: limit}
	var once sync.Once
	release := func() { once.Do(func() { b.Lock(); delete(b.active, part); b.Unlock() }) }
	return limit, release, nil
}
