# 存储、备份与迁移

## 使用独立硬盘目录（高级）

默认命名卷最适合首次部署。如果希望直接在宿主机硬盘看到文件，先停止服务、完整备份，再创建 `compose.override.yaml`：

```yaml
services:
  storage:
    volumes:
      - /mnt/nas:/srv/sftpgo
  tools:
    volumes:
      - /mnt/nas:/source/files
```

Windows 路径示例：`D:/AirCloudData:/srv/sftpgo` 和 `D:/AirCloudData:/source/files`。目录应专供 NAS 使用，不要挂载整个系统盘。Linux 上预先创建 `data`、`backups` 子目录，并赋予容器 UID/GID `1000:1000` 读写权限；Docker Desktop 需允许访问所选硬盘。修改挂载不会自动搬迁旧卷中的文件，需要先恢复完整备份。检查 `docker compose config` 确认两个服务指向同一份文件目录。根目录的 `.env` 与 override 是本机部署设置，备份脚本不会打包它们，请单独保管。

## 恢复完整备份

恢复会覆盖同名数据库和文件。建议在**新主机/空数据卷**中恢复，并保持与备份相同的 SFTPGo 版本。不要把未知来源的归档以 root 权限解压。

1. 取得项目代码并准备 Docker，把归档放入项目 `backups/`。
2. 在项目目录运行 `docker compose stop`。
3. 先检查归档：

```sh
docker compose --profile tools run --rm --no-deps tools tar -tzf /backup/browsernas-日期时间.tar.gz
```

4. 确认归档内容只有 `settings/` 和 `files/`，执行恢复：

```sh
docker compose --profile tools run --rm --no-deps tools tar -xzpf /backup/browsernas-日期时间.tar.gz -C /source
docker compose up -d --wait --wait-timeout 180
```

5. 用旧账号登录，核对文件、下载、分享和配额。

覆盖恢复不会清除归档中不存在的旧文件；需要完全回到备份状态时请使用新的空卷，保留原卷供回退。不要在运行中的数据库上直接覆盖恢复。

## 从原单机版迁移

本平台不会改动旧版 NAS。先在新平台重新创建管理员、用户和配额，再用浏览器将旧版文件下载后上传到新账号；大容量迁移可以备份旧服务后，由管理员把每个用户目录复制到对应的新存储目录，修正权限并在后台重新扫描配额。自定义数据库可能与官方版不兼容，不要直接把旧版数据库覆盖到这里。原版公开链接、头像偏好和回收站数据需要另行迁移；本版本已包含对应功能，但不会自动导入旧机器数据。公网隧道仍需自行配置。

## 升级与回退

1. 用备份脚本保存完整数据库和文件，并把归档复制到另一台设备。
2. 查看 SFTPGo 的版本说明，同步更新 `storage/Dockerfile` 的上游源码提交、归档校验和、运行镜像版本及补丁；修改 `compose.yaml` 的本地镜像标签。Node.js 基础镜像亦应定期更新。
3. 执行 `docker compose build --pull storage`、`docker compose pull portal` 和 `docker compose up -d --wait --wait-timeout 180`。
4. 验证登录、上传下载、分享及用户权限。

数据库可能随升级迁移；回退时需要原版本镜像加升级前的完整备份，不能只改回镜像标签。

## 常见问题

- **启动脚本提示 Docker 不可用**：先启动 Docker，检查 WSL 2 / 虚拟化，以及 Linux containers 模式。运行 `docker info`。
- **镜像拉取失败**：检查访问 Docker Hub 的网络和镜像服务配置，不要把私人 registry token 写进项目代码。
- **局域网打不开**：检查 `.env` 是否为 `NAS_BIND=0.0.0.0`、是否重新启动、主机防火墙和访客 Wi-Fi 隔离。
- **登录被临时限制**：内置防暴力破解机制会封禁重复失败。portal 向后端传递经过校验的连接来源 IP。若前面还有反向代理，需通过 `NAS_TRUSTED_PROXIES` 配置信任的代理地址，否则限流会使用代理地址；共享公网出口仍可能共同受限。不要信任任意公网转发身份头。
- **空间不足**：检查 Docker 数据盘空间及用户配额。只移动代码目录不会移动 Docker 数据卷。
- **访问外部云存储/SMTP 失败**：storage 通过独立 egress 网络访问外部服务，无主机端口映射。检查主机出站防火墙、DNS、SMTP 端口及认证配置。
- **服务无法启动**：执行 `docker compose logs --tail 100`，排查端口占用、挂载权限和磁盘空间。不要通过删除数据卷解决启动问题。

## 定制源码与存储布局

`storage/portable.patch` 基于 Dockerfile 锁定的上游提交；`storage/extensions` 为新增 Go 文件，`storage/overlay` 为定制模板与静态资源。对干净上游源码运行 `node tools/apply-portable.cjs <源码目录>` 后构建，或直接按 Dockerfile 构建。保留上游可配置密码策略；不包含旧机器的统一登录私有接口。

默认用户目录位于 files 卷的 `/srv/sftpgo/data`，回收站位于 `/srv/sftpgo/.air-recycle`，头像偏好位于 `/srv/sftpgo/avatars`，自动备份位于 `/srv/sftpgo/backups`。回收站放在用户根目录之外，备份脚本会完整包含这些数据。自定义用户主目录必须与回收站位于同一文件系统，否则删除明确失败；不会退回永久删除。Linux 使用不覆盖目标的原子重命名。回收站只处理网页文件管理和对应 HTTP 删除操作；SFTP/FTP/WebDAV 删除沿用原协议行为。

验证命令：`npm test`、`docker compose build storage`，随后运行 `.github/workflows/check.yml` 中的会话、分享和 NAS 集成测试。构建阶段验证 Linux 回收站目录权限与不覆盖重命名。测试需使用隔离的测试用户与卷。

## 浏览器账号快速切换

登录后可在右上角用户菜单保存和切换账号，登录页也显示该浏览器已保存的账号。最多保留 10 个账号；会话过期后仍需重新登录。注销当前账号会移除该记录，“退出所有账号”会注销该浏览器保存的全部账号。管理员文件管理的内部临时身份不会保存到列表。

portal 通过 HttpOnly、SameSite Cookie 标识浏览器，原生会话加密保存在 `portal_accounts` 卷的 `/home/node/.air-cloud-accounts`，不保存密码。该卷应与源码、配置分开管理，不提交账号会话或密钥。清除浏览器 Cookie 后需重新添加账号。

## 管理员备份与还原

管理员侧栏的“备份与还原”（`/web/admin/nas-backup`）只对完全登录的全局管理员开放。备份是保存在备份目录下 `air-cloud/` 的 ZIP 文件，可以下载、上传、删除，也可以从中选择内容还原。

- **管理设置**：管理员账号、角色、群组、虚拟文件夹、事件动作与规则、IP 列表、系统配置、管理员 API 密钥和管理员头像。
- **用户信息**：可逐个选择用户；包含账号设置（含密码哈希）、该用户的分享、API 密钥、头像，以及所引用的群组和虚拟文件夹。
- **用户文件**：可逐个选择用户，独立于用户信息，打包该用户主目录里的普通文件和目录（不压缩，不跟随符号链接）。非本地存储的用户只备份信息。回收站和虚拟文件夹映射目录不在备份内。
- **还原**：设置、用户信息、用户文件可分别勾选。已存在的设置和用户可选“只添加不存在的”或“覆盖已有的”；已存在的文件可选“跳过”或“覆盖”。还原不会删除备份之外的文件；还原用户文件要求该用户已存在。还原完成后会对相关用户重新统计配额。
- **安全**：还原只写入用户主目录内，含 `..`、绝对路径、盘符或指向主目录外符号链接的条目会被拒绝并记入警告。备份中包含密码哈希和用户文件，请妥善保管下载的备份文件。
- 同一时间只运行一个备份或还原任务，任务可取消；备份写入临时文件，成功后才改为正式文件。

集成测试：`node tests/backup.integration.cjs`（需要已编译的 `sftpgo`，可用环境变量 `NAS_TEST_BINARY` 指定）。
