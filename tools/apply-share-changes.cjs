// Apply the same small backend changes to upstream or an existing SFTPGo tree.
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
if (!root) throw Error('Usage: node tools/apply-share-changes.cjs <sftpgo-source>');
function edit(name, before, after) {
  const file=path.join(root,name), text=fs.readFileSync(file,'utf8');
  if (!text.includes(before)) throw Error('Source differs at '+name+': '+before);
  fs.writeFileSync(file,text.replace(before,after));
}
fs.copyFileSync(path.join(__dirname,'../storage/air_shares.go'),path.join(root,'internal/httpd/air_shares.go'));
edit('internal/httpd/webclient.go','share.ShareID = util.GenerateUniqueID()',`if err := airAssignShareID(share, r); err != nil {
        s.renderAddUpdateSharePage(w, r, share, util.NewI18nError(err, err.Error()), true)
        return
    }`);
edit('internal/httpd/webclient.go','share, util.NewI18nError(err, util.I18nErrorShareGeneric), true)','share, airShareCreationError(err, r), true)');
edit('internal/httpd/server.go','s.router.Get(webClientPubSharesPath+"/{id}/download", s.handleClientSharedFile)', 's.router.Get(webClientPubSharesPath+"/{id}/download", s.handleClientSharedFile)\n        s.router.Get(webClientPubSharesPath+"/{id}/view", s.handleAirSharePage)');
// Directory listings must not be served from browser or reverse-proxy caches.
edit('internal/httpd/webclient.go','func (s *httpdServer) handleShareGetDirContents(w http.ResponseWriter, r *http.Request) {','func (s *httpdServer) handleShareGetDirContents(w http.ResponseWriter, r *http.Request) {\n    w.Header().Set("Cache-Control", "no-store")');
