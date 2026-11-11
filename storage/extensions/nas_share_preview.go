package httpd

import (
	"bytes"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/drakkan/sftpgo/v2/internal/common"
	"github.com/drakkan/sftpgo/v2/internal/dataprovider"
	"github.com/russross/blackfriday/v2"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

const nasShareTextPreviewLimit = 2 << 20

func nasSharePreviewType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".md", ".markdown", ".mkd":
		return "text/markdown"
	case ".yaml", ".yml", ".txt", ".log", ".json", ".csv":
		return "text/plain"
	case ".pdf":
		return "application/pdf"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png", ".gif", ".webp", ".bmp":
		return "image/" + strings.ToLower(path.Ext(name)[1:])
	case ".mp4", ".webm":
		return "video/" + strings.ToLower(path.Ext(name)[1:])
	case ".mov":
		return "video/quicktime"
	case ".ogv":
		return "video/ogg"
	case ".ogg":
		return "audio/ogg"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	default:
		return ""
	}
}

func nasSharePreviewURL(shareID, key, value string) string {
	return path.Join(webClientPubSharesPath, shareID, "preview") + "?" + url.Values{key: {value}}.Encode()
}

type nasInlineShareResponse struct {
	http.ResponseWriter
	contentType string
}

func (w nasInlineShareResponse) WriteHeader(status int) {
	if status == http.StatusOK || status == http.StatusPartialContent {
		w.Header().Set("Content-Type", w.contentType)
		w.Header().Del("Content-Disposition")
	}
	w.ResponseWriter.WriteHeader(status)
}

func (s *httpdServer) handleNASSharePreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	share, connection, err := s.checkPublicShare(w, r, []dataprovider.ShareScope{dataprovider.ShareScopeRead, dataprovider.ShareScopeReadWrite})
	if err != nil {
		return
	}
	defer connection.CloseFS()

	var name string
	if index := r.URL.Query().Get("item"); index != "" {
		item, err := strconv.Atoi(index)
		if err != nil || item < 0 || item >= len(share.Paths) || r.URL.Query().Has("path") {
			http.NotFound(w, r)
			return
		}
		name = share.Paths[item]
	} else {
		if err := validateBrowsableShare(share, connection); err != nil {
			http.NotFound(w, r)
			return
		}
		name, err = getBrowsableSharedPath(share.Paths[0], r)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}
	if err := common.Connections.Add(connection); err != nil {
		http.Error(w, "Too many connections", http.StatusTooManyRequests)
		return
	}
	defer common.Connections.Remove(connection.GetID())
	info, err := connection.Stat(name, 1)
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	contentType := nasSharePreviewType(name)
	if contentType == "" {
		http.Error(w, "Preview unavailable for this file type", http.StatusUnsupportedMediaType)
		return
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_ = connection.User.CheckFsRoot(connection.ID)
	if strings.HasPrefix(contentType, "text/") {
		nasRenderShareText(w, r, connection, &share, name, contentType, info.Size())
		return
	}
	if contentType == "application/pdf" {
		if err := s.ensurePDF(w, r, name, connection); err != nil {
			return
		}
	}
	if err := dataprovider.UpdateShareLastUse(&share, 1); err != nil {
		http.Error(w, "Share access unavailable", getRespStatus(err))
		return
	}
	response := nasInlineShareResponse{ResponseWriter: w, contentType: contentType}
	if status, err := downloadFile(response, r, connection, name, info, false, &share); err != nil {
		_ = dataprovider.UpdateShareLastUse(&share, -1)
		if status > 0 {
			http.Error(w, "Preview unavailable", status)
		}
	}
}

// Keep encoding detection consistent with the text preview in the signed-in file list.
func nasDecodeShareText(data []byte) ([]byte, error) {
	switch {
	case bytes.HasPrefix(data, []byte{0xff, 0xfe}):
		return unicode.UTF16(unicode.LittleEndian, unicode.ExpectBOM).NewDecoder().Bytes(data)
	case bytes.HasPrefix(data, []byte{0xfe, 0xff}):
		return unicode.UTF16(unicode.BigEndian, unicode.ExpectBOM).NewDecoder().Bytes(data)
	case utf8.Valid(data):
		return bytes.TrimPrefix(data, []byte{0xef, 0xbb, 0xbf}), nil
	default:
		return simplifiedchinese.GB18030.NewDecoder().Bytes(data)
	}
}

func nasRenderShareText(w http.ResponseWriter, r *http.Request, connection *Connection, share *dataprovider.Share,
	name, contentType string, size int64,
) {
	if size > nasShareTextPreviewLimit {
		http.Error(w, "文本超过 2 MiB，请下载后查看。", http.StatusRequestEntityTooLarge)
		return
	}
	reader, err := connection.getFileReader(name, 0, r.Method)
	if err != nil {
		http.Error(w, "Preview unavailable", getMappedStatusCode(err))
		return
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, nasShareTextPreviewLimit+1))
	if err != nil {
		http.Error(w, "Preview unavailable", http.StatusInternalServerError)
		return
	}
	if len(data) > nasShareTextPreviewLimit {
		http.Error(w, "文本超过 2 MiB，请下载后查看。", http.StatusRequestEntityTooLarge)
		return
	}
	data, err = nasDecodeShareText(data)
	if err != nil {
		http.Error(w, "无法识别文本编码，请下载后查看。", http.StatusUnprocessableEntity)
		return
	}
	if err := dataprovider.UpdateShareLastUse(share, 1); err != nil {
		http.Error(w, "Share access unavailable", getRespStatus(err))
		return
	}
	if contentType == "text/plain" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write(data)
		return
	}
	renderer := blackfriday.NewHTMLRenderer(blackfriday.HTMLRendererParameters{
		Flags: blackfriday.SkipHTML | blackfriday.SkipImages | blackfriday.SkipLinks,
	})
	rendered := blackfriday.Run(data, blackfriday.WithRenderer(renderer))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'")
	_, _ = fmt.Fprintf(w, "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>%s</title><style>html{color-scheme:light dark}body{max-width:54rem;margin:2rem auto;padding:0 1rem;font:1rem/1.65 system-ui;overflow-wrap:anywhere}pre{overflow:auto;padding:1rem;background:#8882}table{border-collapse:collapse}th,td{border:1px solid #8888;padding:.35rem .65rem}</style><main>%s</main></html>", html.EscapeString(path.Base(name)), rendered)
}
