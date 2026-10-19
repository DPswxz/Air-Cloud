# Air Cloud

把自己的电脑变成浏览器网盘，支持文件上传下载、分享链接、多用户和回收站。数据保存在自己的设备上。

## 一键部署

### Windows 10 / 11

1. 安装并启动 [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)，使用 WSL 2 / Linux 容器。
2. [下载项目 ZIP](https://github.com/DPswxz/Air-Cloud/archive/refs/heads/main.zip)，解压到长期保留的目录。
3. 双击 **start.cmd**，等待启动完成。
4. 打开 **http://localhost:8088**，进入“初始化 / 管理后台”创建管理员，再添加文件用户。

### Linux / macOS

安装 Docker 和 Compose v2，然后执行：

```sh
git clone https://github.com/DPswxz/Air-Cloud.git
cd Air-Cloud
sh start.sh
```

打开 **http://localhost:8088**，创建管理员，再添加文件用户。无桌面的服务器可先通过 SSH 转发访问：

```sh
ssh -L 8088:127.0.0.1:8088 user@服务器地址
```

首次启动需要联网下载镜像并编译，请耐心等待。**管理员用于管理账号，文件用户用于登录网盘。**

## 让其他设备访问

默认只允许本机访问。完成管理员初始化后，修改项目目录下的 **.env**：

```dotenv
NAS_BIND=0.0.0.0
NAS_PORT=8088
```

重新运行启动脚本，其他设备即可打开 **http://主机局域网IP:8088**。无法连接时，检查主机防火墙是否允许该端口；端口被占用时修改 NAS_PORT。

公网访问请自行配置 VPN 或 HTTPS 反向代理。需要外网分享时，通过自己的 HTTPS 域名创建分享链接。主机需要保持开机、联网。

## 启停、更新与备份

在项目目录执行：

```sh
docker compose stop                       # 停止，保留数据
docker compose up -d --wait                # 启动
docker compose logs --tail 100             # 查看日志
```

更新：先备份，再下载新版替换项目源码（保留 .env 和 backups），执行：

```sh
docker compose build storage
docker compose up -d --wait --wait-timeout 180
```

备份会短暂停止服务，完成后自动启动：

- Windows：`powershell -ExecutionPolicy Bypass -File scripts/Backup.ps1`
- Linux / macOS：`sh scripts/backup.sh`

备份保存在 **backups/**，请另存到其他设备。用户文件和账号保存在 Docker 数据卷中，**不要执行 `docker compose down -v` 或清空 Docker 数据**。

更多设置：[存储、恢复与迁移](docs/operations.md) · [邮箱注册配置](docs/registration.md)。

## 开源许可

基于 [SFTPGo v2.7.6](https://github.com/drakkan/sftpgo/tree/62ae9ba3957e9ed52b44a4f885e805e2d7b35972) 开发，采用 [AGPL-3.0](LICENSE)。[补丁与扩展源码](storage) · [构建文件](storage/Dockerfile) · [附加声明](NOTICE)。
