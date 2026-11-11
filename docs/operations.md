<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

# 运维说明

学堂在线是单进程 Node.js 服务，默认只监听本机 `127.0.0.1`；设置 `HOST=0.0.0.0` 后监听所有网卡，供同一局域网内的其他设备访问。数据存在本地 SQLite 文件中。
所有命令都在项目根目录执行，只需要 Node.js 24，不需要 `npm install`。

## 数据放在哪里

| 位置 | 内容 |
| --- | --- |
| `data/academy.sqlite` | 数据库：账号、会话、课程、配置、迁移记录 |
| `data/run.json` | 运行记录：进程号、访问地址、维护令牌；仅本机用户可读（0600） |
| `backups/` | 备份与“恢复前”快照 |
| `migrations/` | 按编号执行的 SQL 迁移 |
| `media/` | 示例视频，只能通过限时播放地址读取 |

`data/`、`backups/` 和数据库文件都不提交到 Git。

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `DATA_DIR` | `data` | 数据目录（用 npm 运行时，相对路径从项目根目录算起）；所有命令都使用它 |
| `PORT` | `3000` | 服务端口，`0` 表示随机端口 |
| `HOST` | `127.0.0.1` | 监听地址；`0.0.0.0`（或 `::`）监听所有网卡，也可填某个本机 IP |
| `ALLOWED_HOSTS` | 空 | 额外放行的主机名或 IP，逗号分隔；用于 `.local` 名称、端口转发域名或虚拟网卡地址 |
| `BACKUP_DIR` | `backups` | 备份目录 |

同时运行多份时，每份使用不同的 `DATA_DIR` 和 `PORT`，后续维护命令带上相同的 `DATA_DIR`：

```sh
DATA_DIR=data-acceptance PORT=3001 npm start
DATA_DIR=data-acceptance npm run backup
```

## 启动与停止

```sh
npm start
```

| 数据目录的状态 | `npm start` 的行为 |
| --- | --- |
| 还没有数据库 | 建库，执行全部迁移，写入示例账号和课程，然后启动 |
| 数据库已是最新 | 直接启动，保留已有数据 |
| 有待执行的迁移 | 拒绝启动，列出待执行的文件，提示先备份再迁移 |
| 已执行的迁移文件被修改、删除或新文件编号更小 | 拒绝启动，说明哪个文件有问题 |
| 同一数据目录已有服务在运行 | 拒绝启动，给出对方的进程号和地址 |

启动后终端会打印访问地址和示例账号。按 `Ctrl+C` 正常停止：服务关闭连接和数据库，并删除 `run.json`。
如果进程被强制结束，下次启动会发现 `run.json` 里的进程已不存在，自动清理后继续。

## 局域网访问

```sh
HOST=0.0.0.0 npm start
```

- 启动日志除了 `http://localhost:3000`，还会逐行打印本机网卡地址，例如 `局域网访问：http://10.10.31.106:3000`；把对应地址发给同一局域网的其他人即可。
- 服务仍校验 `Host` 请求头：默认模式只放行 `localhost`、`127.0.0.1`、`[::1]`；`HOST=0.0.0.0` 时额外放行本机所有网卡地址。陌生域名返回 400。
- 其他人若通过 `主机名.local`、端口转发域名或 VPN 虚拟网卡地址访问，用 `ALLOWED_HOSTS='my-mac.local,example.internal' HOST=0.0.0.0 npm start` 显式放行；启动日志只列出物理网卡地址。
- **只在可信网络临时开放**：示例账号使用公开密码，服务没有 TLS、没有速率限制，管理后台和数据库内容对同网段所有人可见。用完按 `Ctrl+C` 停止，或省略 `HOST` 重新启动即回到仅本机模式。
- macOS 首次监听所有网卡时可能弹出“允许传入连接”提示，选择允许；若仍无法访问，检查系统防火墙，以及路由器是否开启了客户端隔离（AP 隔离）。

## 备份

```sh
npm run backup
```

1. 如果服务正在运行，脚本用 `run.json` 中的维护令牌请求 `POST /internal/stop`，服务正常关闭数据库后退出。
2. 等 `run.json` 消失后，检查数据库完整性，再复制到 `backups/academy-<日期>-<时间>.sqlite`。
   数据目录不是默认的 `data/` 时，文件名带上目录名，例如 `backups/academy-data-acceptance-<日期>-<时间>.sqlite`。
3. 打印数据目录、备份文件和其中的账号、课程数量。服务保持停止，并给出带原 `DATA_DIR` 和端口的启动命令，例如 `DATA_DIR=data-acceptance PORT=3001 npm start`。

服务没有运行时，脚本直接复制。备份文件从不覆盖已有文件。

## 迁移

新的数据库结构变更写成新的迁移文件，追加在 `migrations/` 末尾：

- 文件名为“编号-英文短名.sql”，编号比已有的都大，例如 `002-enrollments.sql`。
- 已执行过的迁移文件不能修改、删除或改名；要调整就再写一个新迁移。
- 每个文件在一个事务中执行，文件里不要写 `BEGIN` / `COMMIT`。
- 保留已有数据：用 `ALTER TABLE`、`CREATE TABLE`、`INSERT … SELECT` 等方式演进。

运维交接按“备份 → 迁移 → 启动”执行：

```sh
npm run backup     # 正常停服并备份
npm run migrate    # 执行待执行的迁移
npm start          # 用新版本启动
```

`npm run migrate` 要求服务已停止。它逐个执行待执行的迁移并打印文件名；没有待执行的迁移时说明数据库已是最新。
某个文件失败时，该文件整体回滚，之前成功的文件保留；修正后重新运行即可。
迁移期间脚本占用 `run.json`，此时 `npm start` 会提示稍后再试。

## 恢复

```sh
npm run restore -- backups/academy-20261108-153000.sqlite
```

恢复要求服务已停止。脚本会：

1. 检查快照：SQLite 完整性检查通过，并含有学堂的表；
2. 把当前数据库另存为 `backups/before-restore-<日期>-<时间>.sqlite`（非默认数据目录同样带上目录名）；
3. 用快照替换当前数据库，并提示快照中是否还有待执行的迁移。

**快照之后产生的数据不在恢复后的数据库中。** 恢复旧快照后如果提示有待执行的迁移，先 `npm run migrate` 再启动。

### 在副本中演练恢复

演练时不要动正在使用的数据，用另一个数据目录：

```sh
DATA_DIR=data-acceptance npm run restore -- ../lab-data/lab-baseline.sqlite
DATA_DIR=data-acceptance npm run migrate
DATA_DIR=data-acceptance PORT=3001 npm start
```

然后在 <http://localhost:3001> 核对账号和课程。

## 常见问题

| 提示 | 处理 |
| --- | --- |
| 端口已被占用 | 停止占用端口的程序，或换端口：`PORT=3001 npm start` |
| 局域网访问返回 400「请求的 Host 无效」 | 改用启动日志打印的本机 IP；用自定义域名时把它加进 `ALLOWED_HOSTS` |
| 局域网内其他设备连不上 | 确认以 `HOST=0.0.0.0` 启动、允许 macOS 传入连接、双方在同一网段且未开启 AP 隔离 |
| 这个数据目录已有学堂在运行 | 到那个服务的终端按 `Ctrl+C`；或给新实例换一个 `DATA_DIR` |
| 数据库有待执行的迁移 | 按提示依次执行 `npm run backup`、`npm run migrate`、`npm start` |
| 已执行的迁移文件被修改过 | 用 Git 恢复该文件，把改动写成新的迁移 |
| 学堂仍在运行（迁移或恢复时） | 先在服务终端按 `Ctrl+C`，或用 `npm run backup` 正常停服 |

## 示例视频

`media/` 中的四段示例视频由 `scripts/make-media.sh` 生成（需要带 libx264 的 ffmpeg，以及 python3 和 Pillow 用于渲染中文文字）。
换成自己的 MP4 时，文件名使用小写英文、数字和连字符，放入 `media/` 后即可在课程表单中选择。
