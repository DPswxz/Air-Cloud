# Air Cloud

把闲置电脑变成自己的浏览器 NAS。Windows 双击启动，Linux/macOS 一条命令部署；文件、账号和配置保存在自己的电脑上，不依赖项目作者的服务器。

这是现有单机 NAS 的**可移植部署版**：使用官方 SFTPGo v2.7.6 和独立的 Air Cloud 入口。支持浏览器上传下载、文件夹管理、分享链接、多用户、配额和两步验证。原单机版本依赖私有后端的统一账号识别、管理员全部文件视图、头像与回收站扩展未移植；不包含原机器的数据库、密钥、VHDX 或公网中转配置。

## 快速开始

### Windows 10/11

1. 安装并启动 [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)，启用 WSL 2 / Linux containers。需要系统支持虚拟化；初次安装可能需要重启。
2. [下载项目 ZIP](https://github.com/DPswxz/Air-Cloud/archive/refs/heads/main.zip)，解压到准备长期保留的目录。
3. 双击 **`start.cmd`**。脚本会检查 Docker、下载固定版本镜像、启动服务并打开浏览器。
4. 点击“初始化 / 管理后台”，创建管理员，再添加至少一个文件用户。管理员与文件用户是不同账号。

### Linux / macOS

先安装 [Docker Engine + Compose v2 或 Docker Desktop](https://docs.docker.com/get-started/get-docker/)，然后：

```sh
git clone https://github.com/DPswxz/Air-Cloud.git
cd Air-Cloud
sh start.sh
```

打开 **http://localhost:8088**。首次拉取镜像需要网络；启动后访问文件不需要连接项目作者的服务。Linux 需要当前用户具有 Docker 使用权限。支持官方镜像提供的 amd64/arm64 主机，不支持 32 位 Windows、旧版 Windows 或无容器环境的一键原生安装。

## 初始化与共享

默认只绑定 `127.0.0.1`，先在 NAS 主机浏览器里创建管理员，避免其他人抢先初始化。无图形界面的 Linux 可先通过 SSH 转发本机访问：`ssh -L 8088:127.0.0.1:8088 user@nas-host`。

进入管理后台的“用户”页面创建账号。主目录留空时由 SFTPGo 在 `/srv/sftpgo/data/<用户名>` 下创建；按需要设置读写权限、存储配额。用这个账号进入“我的文件”。在浏览器语言偏好中优先选择简体中文可使用 SFTPGo 中文界面。

完成初始化后，修改项目根目录的 `.env`：

```dotenv
NAS_BIND=0.0.0.0
NAS_PORT=8088
```

重新运行启动脚本，家人即可通过 `http://主机局域网IP:8088` 访问。Windows 防火墙如需放行，只针对家庭/专用网络开放选定端口；本项目不自动更改防火墙或路由器设置。端口被占用时修改 `NAS_PORT`。

公网访问推荐 VPN（如 Tailscale）或自行配置 HTTPS 反向代理，不要把 HTTP 8088 直接暴露到公网。分享链接使用创建分享时访问的主机地址：需要外网分享时，应通过自己的 HTTPS 域名登录后创建分享。原机器的域名、FRP、VPS 不随项目提供。主机关机或断网后文件不可访问；应关闭自动睡眠并确保磁盘空间充足。

## 数据与容量

Docker 命名卷 `browsernas_settings` 保存账号数据库及配置，`browsernas_files` 保存用户文件及服务备份。实际磁盘位置由 Docker 管理，可用 `docker volume inspect browsernas_files` 查看；Windows/macOS 位于 Docker 的 Linux 虚拟磁盘中，不是项目文件夹。**删除或重置 Docker 数据会丢失 NAS 数据。**

不创建虚拟硬盘、不格式化现有硬盘、不扫描整台电脑。默认容量取决于 Docker 可用磁盘空间及用户配额。需要将文件存到第二块硬盘的高级部署，见 [存储、备份与迁移](docs/operations.md)。当前电脑原有 NAS 继续独立运行；新平台不会自动接管它的数据或账号。

## 日常管理

在项目目录执行：

```sh
docker compose ps                         # 查看状态
docker compose logs --tail 100            # 排查启动问题
docker compose stop                      # 停止，保留数据
docker compose up -d --wait               # 启动
docker compose down                      # 移除容器，保留数据卷
```

不要执行 `docker compose down -v`，它会删除数据卷。Docker Engine 启动后容器会按 `unless-stopped` 策略恢复；Windows/macOS 需要在 Docker Desktop 中启用登录时启动。这里的一键部署以已安装 Docker 为前提，不会静默安装系统组件。

## 备份

Windows：右键 PowerShell 在项目目录执行 `powershell -ExecutionPolicy Bypass -File scripts/Backup.ps1`。

Linux/macOS：执行 `sh scripts/backup.sh`。

备份期间服务暂停，完成后自动重启。完整备份位于 `backups/browsernas-日期时间.tar.gz`，含数据库和文件，需要足够磁盘空间。备份含私人数据及账号信息，应复制到其他物理设备妥善保管。[恢复与升级步骤](docs/operations.md)。

## 开发与验证

无需 npm 安装依赖。Node.js 22+ 下运行 `npm test`，覆盖入口、服务健康、代理身份头过滤、会话 Cookie、二进制上传和后端故障。`docker compose config --quiet` 校验容器配置。GitHub Actions 还会拉取真实镜像，验证容器启动、初始化页和备份恢复。

本地开发：设置 `NAS_UPSTREAM=http://127.0.0.1:你的SFTPGo端口`，再运行 `node portal/server.cjs`。正式部署通过 Compose 提供内部地址。文件传输通过流转发，不整文件读入内存，也没有五分钟总请求时限。

## 许可与致谢

本项目以 [AGPL-3.0](LICENSE) 发布。文件服务由 [SFTPGo / Nicola Murino 及贡献者](https://github.com/drakkan/sftpgo) 提供，使用未修改的官方 v2.7.6 镜像；[对应源代码](https://github.com/drakkan/sftpgo/tree/v2.7.6)。请保留 [附加声明](NOTICE)。Air Cloud 是独立项目，不代表获得 SFTPGo 作者背书。Node.js 与 Alpine 镜像遵循各自许可证。
