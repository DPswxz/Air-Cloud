package httpd

import (
 "fmt"
 "net/http/httptest"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
)

func TestNASArchiveRangeIsolationAndExpiry(t *testing.T) {
 owner:=fmt.Sprintf("test:%s:%d",t.Name(),time.Now().UnixNano());dir:=nasArchiveOwnerDir(owner)
 if err:=os.MkdirAll(dir,0700);err!=nil{t.Fatal(err)};defer os.RemoveAll(dir)
 id:=strings.Repeat("a",32);meta:=filepath.Join(dir,id+".json")
 if err:=os.WriteFile(filepath.Join(dir,id+".zip"),[]byte("0123456789"),0600);err!=nil{t.Fatal(err)}
 if err:=writeNASArchiveState(meta,nasArchiveState{State:"ready",Size:10});err!=nil{t.Fatal(err)}
 request:=httptest.NewRequest("GET","/archive?archive="+id,nil);request.Header.Set("Range","bytes=2-5")
 response:=httptest.NewRecorder();serveNASArchive(response,request,owner)
 if response.Code!=206||response.Body.String()!="2345"{t.Fatalf("range: %d %q",response.Code,response.Body.String())}
 etag:=response.Header().Get("ETag");request.Header.Set("If-Range",etag);response=httptest.NewRecorder();serveNASArchive(response,request,owner)
 if response.Code!=206{t.Fatalf("matching If-Range: %d",response.Code)}
 response=httptest.NewRecorder();serveNASArchive(response,request,owner+"other");if response.Code!=404{t.Fatal("cross-owner access allowed")}
 request=httptest.NewRequest("GET","/archive?archive=../bad",nil);response=httptest.NewRecorder();serveNASArchive(response,request,owner);if response.Code!=404{t.Fatal("invalid ID accepted")}
 old:=time.Now().Add(-nasArchiveTTL-time.Hour);if err:=os.Chtimes(meta,old,old);err!=nil{t.Fatal(err)}
 request=httptest.NewRequest("GET","/archive?archive="+id,nil);response=httptest.NewRecorder();serveNASArchive(response,request,owner);if response.Code!=404{t.Fatal("expired archive accepted")}
}
