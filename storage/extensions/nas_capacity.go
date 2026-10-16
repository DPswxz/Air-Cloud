package httpd

import (
	"encoding/json"
	"github.com/drakkan/sftpgo/v2/internal/common"
	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"net/http"
)

func handleNASCapacity(w http.ResponseWriter, r *http.Request) {
	c, err := getUserConnection(w, r)
	if err != nil {
		return
	}
	defer common.Connections.Remove(c.GetID())
	if c.User.IsNASAdminFileView() {
		fs, root, err := c.GetFsAndResolvedPath("/")
		if err != nil {
			sendAPIResponse(w, r, nil, "磁盘容量暂时不可用", 503)
			return
		}
		stat, err := fs.GetAvailableDiskSize(root)
		if err != nil {
			sendAPIResponse(w, r, nil, "磁盘容量暂时不可用", 503)
			return
		}
		capacity := int64(stat.Blocks) * int64(stat.Bsize)
		remaining := int64(stat.Bavail) * int64(stat.Bsize)
		if remaining > capacity {
			remaining = capacity
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(map[string]any{"scope": "disk", "capacity": capacity, "used": capacity - remaining, "remaining": remaining, "recycle": 0, "quota_limited": false})
		return
	}
	files, used, _, _, err := dataprovider.GetUsedQuota(c.User.Username)
	if err != nil {
		sendAPIResponse(w, r, nil, "容量统计暂时不可用", 503)
		return
	}
	capacity := c.User.QuotaSize
	if capacity <= 0 {
		fs, p, e := c.GetFsAndResolvedPath("/")
		if e == nil {
			if dataprovider.GetQuotaTracking() == 2 && c.User.QuotaSize == 0 && c.User.QuotaFiles == 0 {
				files, used, e = fs.GetDirSize(p)
				if e != nil {
					sendAPIResponse(w, r, nil, "容量统计暂时不可用", 503)
					return
				}
			}
			stat, e := fs.GetAvailableDiskSize(p)
			if e == nil {
				capacity = int64(stat.Blocks) * int64(stat.Bsize)
			}
		}
	}
	var recycle int64
	nasRecycleMu.Lock()
	items := nasRecycleItems(nasRecycleRoot(&c.User))
	for _, item := range items {
		recycle += item.Bytes
	}
	nasRecycleMu.Unlock()
	if used < 0 {
		used = 0
	}
	if files < 0 {
		files = 0
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(map[string]any{"capacity": capacity, "used": used, "recycle": recycle, "files": files, "recycle_items": len(items), "quota_limited": c.User.QuotaSize > 0})
}
