package httpd

import (
 "errors"
 "fmt"
 "os"
 "path/filepath"
 "testing"
)

func TestNASRecycleBrowseHierarchy(t *testing.T) {
 root:=t.TempDir()
 if err:=os.MkdirAll(filepath.Join(root,"folder","nested"),0700);err!=nil{t.Fatal(err)}
 if err:=os.WriteFile(filepath.Join(root,"folder","nested","文件.txt"),[]byte("hello"),0600);err!=nil{t.Fatal(err)}
 page,err:=nasRecycleChildren(root,"",0)
 if err!=nil||len(page.Items)!=1||page.Items[0].Name!="folder"||!page.Items[0].Directory{t.Fatalf("root listing: %+v %v",page,err)}
 page,err=nasRecycleChildren(root,"folder/nested",0)
 if err!=nil||len(page.Items)!=1||page.Items[0].Path!="folder/nested/文件.txt"||page.Items[0].Directory||page.Items[0].Bytes!=5{t.Fatalf("nested listing: %+v %v",page,err)}
 for _,relative:=range []string{"..","../outside","folder/../../outside","/absolute","folder/../folder","folder\\nested","C:/outside","folder:stream","folder/",string([]byte{0})}{
  if _,err:=nasRecycleChildren(root,relative,0);!errors.Is(err,os.ErrPermission){t.Errorf("unsafe path %q accepted: %v",relative,err)}
 }
 for _,offset:=range []int{-1,1000001}{if _,err:=nasRecycleChildren(root,"",offset);!errors.Is(err,os.ErrPermission){t.Errorf("unsafe offset %d accepted",offset)}}
}

func TestNASRecycleBrowsePages(t *testing.T){
 root:=t.TempDir()
 for i:=0;i<nasRecyclePageSize+17;i++{if err:=os.WriteFile(filepath.Join(root,fmt.Sprintf("file-%03d.txt",i)),nil,0600);err!=nil{t.Fatal(err)}}
 first,err:=nasRecycleChildren(root,"",0);if err!=nil||!first.More||len(first.Items)!=nasRecyclePageSize||first.NextOffset!=nasRecyclePageSize{t.Fatalf("first page: %+v %v",first,err)}
 second,err:=nasRecycleChildren(root,"",first.NextOffset);if err!=nil||second.More||len(second.Items)!=17{t.Fatalf("second page: %+v %v",second,err)}
 seen:=map[string]bool{};for _,page:=range []nasRecyclePage{first,second}{for _,item:=range page.Items{if seen[item.Path]{t.Fatalf("duplicate %s",item.Path)};seen[item.Path]=true}}
 empty,err:=nasRecycleChildren(root,"",second.NextOffset);if err!=nil||len(empty.Items)!=0||empty.More{t.Fatalf("end of pages: %+v %v",empty,err)}
}

func TestNASRecycleBrowseRejectsLinks(t *testing.T){
 root,outside:=t.TempDir(),t.TempDir()
 if err:=os.WriteFile(filepath.Join(outside,"secret.txt"),[]byte("private"),0600);err!=nil{t.Fatal(err)}
 link:=filepath.Join(root,"link")
 if err:=os.Symlink(outside,link);err!=nil{t.Skipf("symlinks unavailable: %v",err)}
 for _,test:=range []struct{root,path string}{{root,"link"},{link,""}}{if _,err:=nasRecycleChildren(test.root,test.path,0);!errors.Is(err,os.ErrPermission){t.Fatalf("followed directory link: %v",err)}}
 page,err:=nasRecycleChildren(root,"",0);if err!=nil||len(page.Items)!=1||page.Items[0].Directory{t.Fatalf("link must not be expandable: %+v %v",page,err)}
}
