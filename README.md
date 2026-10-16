# Air Cloud

把闲置电脑变成自己的浏览器 NAS。Windows 双击启动，Linux/macOS 一条命令部署；文件、账号和配置保存在自己的电脑上，不依赖项目作者的服务器。

这是现有单机 NAS 的**可移植部署版**：基于 SFTPGo v2.7.6，加入 30 天网页登录补丁和独立的 Air Cloud 入口。支持浏览器上传下载、文件夹管理、分享链接、多用户、配额和两步验证。已移植最新文件界面、后台传输、递归搜索、管理员全部文件视图、头像、回收站和容量概览；管理员与文件用户继续使用各自登录入口，不包含原机器的数据库、密钥、VHDX 或公网中转配置。

## 快速开始

最新界面包含可展开目录的传输列表与统一高度动画、回收站多选和右键操作、随机默认头像及折叠头像选择器。确认弹窗与页面按钮共用主题；注销会清理文件页缓存外壳，管理后台以完整页面打开。

### Windows 10/11

1. 安装并启动 [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/)，启用 WSL 2 / Linux containers。需要系统支持虚拟化；初次安装可能需要重启。
2. [下载项目 ZIP](https://github.com/DPswxz/Air-Cloud/archive/refs/heads/main.zip)，解压到准备长期保留的目录。
3. 双击 **`start.cmd`**。脚本会检查 Docker、下载固定版本基础镜像并自动构建文件服务、启动服务并打开浏览器。
4. 点击“初始化 / 管理后台”，创建管理员，再添加至少一个文件用户。管理员与文件用户是不同账号。

### Linux / macOS

先安装 [Docker Engine + Compose v2 或 Docker Desktop](https://docs.docker.com/get-started/get-docker/)，然后：

```sh
git clone https://github.com/DPswxz/Air-Cloud.git
cd Air-Cloud
sh start.sh
```

打开 **http://localhost:8088**。首次拉取镜像及编译文件服务需要网络和数分钟时间；启动后访问文件不需要连接项目作者的服务。Linux 需要当前用户具有 Docker 使用权限。支持官方镜像提供的 amd64/arm64 主机，不支持 32 位 Windows、旧版 Windows 或无容器环境的一键原生安装。

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

## 自定义分享链接与文件夹分享

创建分享时可填写“自定义分享后缀”，例如 `1`，复制的分享链接就是 `https://你的域名/1`。支持 1–64 位字母、数字、下划线和短横线，留空自动生成；后缀在所有用户之间唯一，已占用时会提示更换。默认 Bolt 数据库支持在编辑分享时修改后缀；修改后旧链接失效，需重新发送新链接。其他数据库明确提示不支持修改。

“复制分享链接”使用复制图标，“打开分享页面”使用打开图标。短链接打开后会跳转到原生分享页面，以保持访问密码 Cookie 的作用范围。

分享单个文件夹时，接收者可以浏览子目录、直接下载文件，也能选中部分文件打包下载。分享始终指向原文件夹，新增、修改、删除会同步反映，页面每 10 秒刷新列表（正在选择文件时暂停自动刷新）；文件不会复制成静态快照。原有密码、有效期和下载次数限制继续生效。

## 最新文件管理功能

固定侧栏支持收缩和明亮/深色主题同步；文件名点击选中，文件夹点击进入。顶部操作栏、右键菜单和 F2 支持下载、移动、重命名、分享及删除。递归搜索当前账号可访问目录，最多扫描 100000 项/12 秒并返回 2000 项，达到限制时提示缩小范围。

后台上传可在目录、分享和个人信息间切换；刷新或关闭标签页会中断任务。启用临时文件原子上传，取消覆盖上传保留旧文件。单文件下载使用浏览器下载列表；Chrome/Edge 的安全上下文支持批量选择保存目录、保留目录结构和分段下载，进度显示在网页传输面板。目录授权被浏览器拒绝时请选择普通文件夹；HTTP 环境请使用单文件下载或自行启用 HTTPS。

删除进入按账号隔离的回收站，默认保留 30 天，可改为 7 天；恢复不覆盖同名文件并检查配额和权限。后台每小时清理过期项目。回收站占用物理磁盘，容量概览单独显示活动文件、回收站与剩余容量。彻底删除或清空不可恢复。仅支持本地文件系统和同一文件系统内移动；远程/跨设备存储删除会报错。

管理员可进入“全部文件”管理注册用户目录；其文件会话跟随管理员权限和凭证失效。个人信息支持内置头像选择。简体中文为默认界面语言，容量显示使用 KB/MB/GB/TB，仍按 1024 进位。

## 30 天免登录

浏览器登录成功后自动记住登录状态，有效期为 **30 天**（管理员和文件账号均适用）。关闭浏览器、重启主机或文件服务后，使用同一浏览器、同一访问地址仍可继续访问，无需再次输入密码。只在 HttpOnly Cookie 中保存签名凭证，不保存明文密码；REST API 和分享链接认证的有效期不延长。

30 天从这次登录算起，不无限续期；到期后重新登录。点击“退出登录”会清除凭证并立即使该凭证失效，清理浏览器 Cookie 或使用无痕窗口也需要重新登录。服务端签名密钥自动生成并保存在数据库同一数据卷，备份恢复时一并保留。轮换或删除此密钥可强制所有浏览器重新登录。请勿把密钥加入 Git。

已有安装更新本项目后执行 `docker compose build storage`，再执行 `docker compose up -d --wait --wait-timeout 180`。更新前登录的旧凭证不会自动变成 30 天，需要重新登录一次。公网使用应启用 HTTPS。

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

本项目以 [AGPL-3.0](LICENSE) 发布。文件服务由 [SFTPGo / Nicola Murino 及贡献者](https://github.com/drakkan/sftpgo) 提供，基于官方 v2.7.6 镜像，重新编译了网页登录期限及分享功能补丁；[上游对应源代码](https://github.com/drakkan/sftpgo/tree/62ae9ba3957e9ed52b44a4f885e805e2d7b35972) + [本项目补丁与扩展源码](storage) + [可复现构建步骤](storage/Dockerfile)。请保留 [附加声明](NOTICE)。Air Cloud 是独立项目，不代表获得 SFTPGo 作者背书。Node.js 与 Alpine 镜像遵循各自许可证。
