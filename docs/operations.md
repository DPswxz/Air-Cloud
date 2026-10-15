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
- **登录被临时限制**：内置防暴力破解机制会封禁重复失败。代理后端默认只看到网关地址，共享出口可能共同受限；稍后重试，查看日志排查。不要直接信任来自公网的转发身份头。
- **空间不足**：检查 Docker 数据盘空间及用户配额。只移动代码目录不会移动 Docker 数据卷。
- **访问外部云存储/SMTP 失败**：文件服务默认位于隔离内网，不具备互联网出站能力。需要这些功能时自行调整 Compose 网络并测试访问控制。
- **服务无法启动**：执行 `docker compose logs --tail 100`，排查端口占用、挂载权限和磁盘空间。不要通过删除数据卷解决启动问题。

## 定制源码与存储布局

`storage/portable.patch` 基于 Dockerfile 锁定的上游提交；`storage/extensions` 为新增 Go 文件，`storage/overlay` 为定制模板与静态资源。对干净上游源码运行 `node tools/apply-portable.cjs <源码目录>` 后构建，或直接按 Dockerfile 构建。保留上游可配置密码策略；不包含旧机器的统一登录私有接口。

默认用户目录位于 files 卷的 `/srv/sftpgo/data`，回收站位于 `/srv/sftpgo/.air-recycle`，头像偏好位于 `/srv/sftpgo/avatars`，自动备份位于 `/srv/sftpgo/backups`。回收站放在用户根目录之外，备份脚本会完整包含这些数据。自定义用户主目录必须与回收站位于同一文件系统，否则删除明确失败；不会退回永久删除。Linux 使用不覆盖目标的原子重命名。回收站只处理网页文件管理和对应 HTTP 删除操作；SFTP/FTP/WebDAV 删除沿用原协议行为。

验证命令：`npm test`、`docker compose build storage`，随后运行 `.github/workflows/check.yml` 中的会话、分享和 NAS 集成测试。构建阶段验证 Linux 回收站目录权限与不覆盖重命名。测试需使用隔离的测试用户与卷。
