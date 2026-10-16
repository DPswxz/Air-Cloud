package httpd

import (
	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/drakkan/sftpgo/v2/internal/util"
	"strings"
"path"
"time"
)

type nasSharedItem struct {
	Name      string
	Directory bool
}
type nasShareRow struct {
	dataprovider.Share
	Directory bool `json:"directory"`
}

func nasSharedDirectory(user *dataprovider.User, name string) bool {
	fs, err := user.GetFilesystemForPath(name, "air-share-icon")
	if err != nil {
		return false
	}
	p, err := fs.ResolvePath(name)
	if err != nil {
		return false
	}
	info, err := fs.Stat(p)
	return err == nil && info.IsDir()
}
func nasDisplaySize(size int64) string {
	return strings.NewReplacer("KiB", "KB", "MiB", "MB", "GiB", "GB", "TiB", "TB", "PiB", "PB", "EiB", "EB").Replace(util.ByteCountIEC(size))
}

// Public share identity exposes only the sharer name and selected preset avatar.
type nasShareIdentity struct {
 ShareOwner string
 ShareOwnerAvatar string
 ShareTitle string
 ShareTime string
}
func nasPublicShareIdentity(share *dataprovider.Share) nasShareIdentity {
 names := make([]string,0,len(share.Paths))
 for _, p := range share.Paths { names=append(names,path.Base(p)) }
 return nasShareIdentity{ShareOwner:share.Username,ShareOwnerAvatar:nasAvatarURL("user",share.Username),ShareTitle:strings.Join(names,"、"),ShareTime:time.UnixMilli(share.CreatedAt).In(time.FixedZone("Asia/Shanghai",8*60*60)).Format("2006/01/02 15:04")}
}
