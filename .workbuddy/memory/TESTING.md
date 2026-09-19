# 测试 / 验证 / 本机环境 — 明细

> 从 `MEMORY.md` 拆出的明细页。改动 §3 任一不变量后，必须跑对应套件。

## A. 验证脚本清单（根目录，一键 `node _run_regression.mjs` → `_regression.txt`）
格式 `脚本(项数)→输出`；🌐=真实 Chrome，☁=打线上。

- **套餐/权益** `_verify_plan_isolation.mjs`(33)→`_plan.log`；`_verify_member_ui.mjs`(9)🌐
- **头像** `_verify_avatar.mjs`(14)→`_avatar_probe.txt`；`_verify_avatar_restart.mjs`(17)；`_verify_avatar_e2e.mjs`(15)；`_probe_avatar_live.mjs`(12)☁
- **原子落盘** `_verify_atomic_store.mjs`(12) 40 写 + 400 并发读零撕裂
- **后台鉴权** `_verify_admin_auth.mjs`(27)→`_admin.log`(沙箱内故意配白名单证漏洞已堵)；`_verify_admin_ui.mjs`(17)🌐；`_verify_admin_live.mjs`(12)🌐☁；`_probe_live_admin.mjs`(18)→`_admin_live_api.txt`☁；`_verify_admin_audit.mjs`(24)→`_admin_audit.log`
- **收集身份** `_verify_collect_login.mjs`(43)→`_collect_login.txt`；`_verify_collect_login_ui.mjs`(14)🌐
- **团队上传** `_verify_team_upload.mjs`(23)→`_team_upload.txt`；`_verify_team_upload_ui.mjs`(14)🌐；`_verify_team_upload_live.mjs`(6)→`_probe_team_live.txt`☁
- **团队预览** `_verify_team_preview.mjs`(16)→`_team_preview_fix.txt`🌐；`_verify_team_preview_live.mjs`(21)→`_team_preview_live.txt`🌐☁；`_repro_team_preview{,_ui}.mjs`(13/10) 保留作修复前对照
- **邀请/入团/昵称** `_verify_invite.mjs`(38)→`_invite.log`；`_verify_invite_browser.mjs`(12)🌐；`_verify_link.mjs`(23)→`_link.log`；`_verify_flow.mjs`(48)→`_flow.log`；`_verify_nickname.mjs`(19)→`_nick.log`
- **布局** `_verify_layout_real.mjs`(46)🌐；`_verify_layout.mjs`(39)→`_layout.log`；`_verify_served.mjs`(21)→`_served.log`
- **UI 契约** `_verify_fixes.mjs`(50)→`_fixes.txt`；`_verify_visual_fixes.mjs`(27)→`_visual.txt`🌐
- **验收会话** `_verify_impersonate.mjs`(7)→`_impersonate_smoke.txt`
- **安全验收(2026-09-19 新增)** `_verify_team_token_leak.mjs`(7)；`_verify_rate_limits.mjs`(3,验证码/取件码限流)
- ⚠️ `_run_regression.mjs` 统计口径已改为**优先解析「结果：x/y」声明行**(fail=y−x)，无声明行才回退 `\bPASS\b`/`\bFAIL\b` 计数（旧正则会把声明行也计入，FAIL 虚高）

## B. 环境与工具约束（本机 Windows）
- **Bash 工具不可用**：缺 `ls`/`cat`/`head`/`sleep`/`cut`/`grep`/`tail`(路由到被禁用的 WSL) → 用**绝对路径 Node** + `node -e` 或临时 `.mjs`；语法校验用 `PortableGit\...\bash.exe -n`
- ⚠️ `node -e "..."` 里**别用反引号**(Bash 先做命令替换 → SyntaxError)；复杂脚本写成临时 `.mjs`
- ⚠️ **Bash 下 node 脚本 exit code 不可信**：包装器自身返回 127(shim 缺 `dirname`)，与脚本真实退出码无关 → 判成功看**脚本自己写的日志文件**或 `echo NODE_EXIT=$?`。`ls`/`tail` 返回 127 时别当成「文件不存在」
- ⚠️ Bash `rm -f` 可能静默失败(safe-bin shim 报 `dirname: command not found` 后不删) → 用 **PowerShell `Remove-Item -Force`** 或 Node `fs.unlinkSync`，再用 `git status` 复核
- **PowerShell 工具 stdout 会被吞** → 重定向到文件后用 Read 读
- **沙箱内起服务**：脚本内 `spawn` 会 exit 127 且零输出(沙箱限制)。测服务端要在**同进程内**：
  拷 `server.mjs` 到临时沙箱 + node_modules junction + **先写 `storage/metadata.json` 快照再 import**，
  `await import(pathToFileURL(沙箱/server.mjs).href)` 起 Express 再 fetch。Windows 绝对路径必须 `pathToFileURL()`
- 例外：需**真实 HTTP 到独立端口**(如真实浏览器套件)时用 `spawn` 并在其 `cwd` 内跑，但**必须消费 stdout/stderr**(见 §C 死锁)
- ⚠️ `fs.cpSync(目录,目录,{recursive:true})` 会**静默杀掉整个 node 进程**(exit 127、零输出) → 自写 `copyTree` 递归 `copyFileSync`，或优先 `fs.symlinkSync(真实 node_modules, 沙箱/node_modules, 'junction')`
- **`server.mjs` 不导出 app**(`Object.keys(mod)` 为空)，靠 side effect 自行 listen。验证脚本**不要**自己 `server.listen()`(抛错静默退出)；应设 `process.env.PORT` → import → 轮询 `/api/health`
- 隔离测试必须显式 `KUNQIONG_DB_ENABLED=false`(`.env` 默认 `true`，本地会连远程 MySQL 并覆盖本地改动)；
  且 test 模式下 `KUNQIONG_TEST_ENFORCE_ENTERPRISE_ALLOWLIST` 默认 `true` → 非白名单用户全被压成 `free`，做演示要显式设 `false`
- **改库后内存态不重载**：服务启动即加载 `metadata.json`，脚本手工改库必须**重启服务**才生效
- 探针路由**必须从 server.mjs 核对，别猜**：后台只有 `PATCH /api/admin/users/:userId`，没有 GET 单用户。**404「接口不存在」= 探针写错了，与鉴权无关**

## C. 测试与排查纪律
- **断言要描述期望行为，不要描述当时的实现**：曾把「team-card 通栏」写进断言，而它正是 bug 根源，修 bug 时反被自己的测试拦住。产物 minify 后**函数名会被 mangle**，只能断言字符串字面量与 className
- **种子数据的形状必须照抄真实结构**：`metadata.users`/`records`/`messages` 是**以 userId 为键的对象**而非数组
  (`accountUserById → metadata.users[key]`)。写成数组 → 端点恒 404，看着像路由没注册。**造种子前先读对应 lookup 函数**
- **种子 session 必须写完整用户快照**(踩过两次)：只写 `user:{id}`，截图里提交者显示成「鲲穹用户」。**所有写 metadata 种子的地方都要统一检查**
- **测试顺序会互相污染**：消耗配额/改状态的用例(如限流)必须放在校验类用例**之后**
- **fetch stub 返回体必须结构完整**：页面读 `data.share.files.length` 就得回 `{share:{files:[...]}}`；stub 注入脚本里别做 `JSON.stringify(JSON.stringify(obj))`
- **负向断言必须精确到特征串**：`!/该团队/.test(html)` 会误命中正常说明句 → 假阳性
- **从源码抽取函数做单测**：`src.indexOf('function name(')` 只命中声明行(真实签名常跨行) → 先找 `'\nfunction name('`，再 `indexOf(')')` 定位签名末尾，从末尾往后找第一个 `{` 配平。抽出函数依赖几十个自由变量，需补最小桩
- **脚本"卡住零输出"先怀疑前面某步耗时过长**：一次 `_verify_avatar_e2e.mjs` 零输出真因是开头 `fs.rmSync(旧沙箱)` 耗时 ~87s 触发工具超时。**定位手段永远是分步 `trace()` 写文件，别靠猜**
- **UI 套件两种输出形态，stdout 尾部无「结果」≠ 失败**：stdout 型（admin_ui/collect_login_ui）直接打「结果：x/y」；写文件型（layout_real→`_verify_layout_real.txt`、member_ui→`_member_ui.txt`、visual_fixes→`_visual.txt`、team_upload_ui→`_team_upload_ui.txt`、team_preview→`_team_preview_fix.txt`）stdout 只剩服务启动日志，**结果看对应 .txt 的 mtime 判断新旧**
- **for 循环串行跑多个 Chrome 套件会偶发卡死**：一次 team_upload_ui 在循环里卡 20+ 分钟（无输出、无 Chrome 进程、结果文件不更新），TaskStop 后**单独重跑 46 秒全绿** → 套件卡死先单独复跑再下结论，别当场归因为代码问题
- **`spawn` 子进程只 pipe 不读 = 死锁**：`stdio:['ignore','pipe','pipe']` 却只监听 `stderr`，子进程 stdout 缓冲写满后阻塞在 write，表现为**脚本卡在「子进程已启动」零输出**。同一脚本先前能跑通只是缓冲还没写满 —— 偶发性陷阱 → **每个 pipe 出来的流都必须消费**
- **同一端口先后起两个实例 = 后一个静默失败**：前进程未释放端口，后进程绑定失败但**旧进程仍应答**，表现为「改了 `NODE_ENV` 判定却没生效」。极易误判成代码问题 → **不同场景用不同端口**，且 `kill` 后**等子进程真正退出**(轮询 `exitCode`/`signalCode`)再起下一个
- **jsdom 不做真实布局**：能断言结构，但「结构对 ≠ 视觉对」。「位置/宽度/是否同一行」必须用**真实浏览器**测
- **CSS `width` 与 `max-width` 是两回事**：`.team-join-card` 写在 `.public-card` 之前且同特异性 → 后者赢，`width: min(570px,100%)` 把卡片硬顶成 570px。只写 `max-width: none` 管不住 width，必须显式 `width: 100%`
- **兜底文案在「对象不存在」路径上会变成误导**：`state.organizationName || '该团队'` 在团队已删除时变成「加入『该团队』团队空间」且无按钮。**对象不存在的分支要显式渲染「不可用」状态，不要回落默认值**
- **渲染 dist 产物必须放子进程**：产物是 ESM，同进程重复 `import` 命中模块缓存(React 不再挂载)，用 `?v=` 绕缓存又会让 Vite URL 处理崩 → 一个路由一个子进程 `execFileSync(process.execPath, [child.mjs, urlPath, outFile])`，结果写 JSON 回读
- **「改了没生效」排查顺序**：产物 CSS → 产物 JS → 构建时间 vs 源码时间 → 本地起 server 验返回 hash → **真实浏览器断言几何**。前四步都过而几何仍不对，那就是真 bug(别急着归因缓存)
- **修安全漏洞的验证纪律**：要证明「漏洞已堵」，测试环境必须**保留原本会触发漏洞的配置**；只在默认配置下跑等于什么也没验证
- **「权限类 Bug」先复现再改，别读代码猜**：团队上传 403 的全部信息就是一句 toast，真因(`readShareOptions` 用个人 `permanent` 校验团队资源)靠**沙箱复现**才锚定；复现脚本第一步就把 403 原样打出来，改完立刻变 201 —— 前后对照即证据
- **修复要限定在出问题的那条路径**：团队资源放宽 permanent 时，必须同时断言「基础版成员**个人**永久分享仍 403」。放宽一个条件很容易连带放开相邻语义 → 每个不变量都要有**反向对照断言**
- **断言响应结构前先读源码**：管理端 collection 返回 `{collection:{submissions}}` 而非 `{task:{submissions}}`；猜错结构得一堆假 FAIL
- **写断言前先确认产品意图**：`/api/collections/manage/:manageToken` 设计就是 **token 即凭证**(非所有者 200 是正确行为)。把「我以为的权限模型」当成期望行为，会写出与产品冲突的测试
- **UI 断言「成功提示」必须轮询等待**：上传完成会触发一次 `load()` 刷新，toast 渲染有延迟；固定 `sleep` 取样会误判失败 → 循环 sleep 轮询目标条件，命中即 break
- **线上断言大文件渲染要轮询，不能固定 sleep 后采一次**：线上团队资源多为 2MB+ 大图，`sleep(2000)` 后读一次 `img.complete` 会偶发 `false` → 误报「预览失败」。改为轮询等待 `img.complete`(上限 ~20s)
- **线上端到端要拿真实会话，别 mock `/api/auth/me`**：伪造用户不属于任何团队 → 拿不到真实团队资源 → UI 断言只能跳过，「线上是否真修好」无法证明。测试服可用 `POST /api/admin/impersonate` 签发真实会话
- **脚本里写死 commit 哈希 = 每轮部署都误报**：曾断言 `release.startsWith('603ca9f')`，下次推送即红 → **断言目标要从仓库动态取**(`git rev-parse origin/main`，取不到就 `git fetch` 一次)，并对「差异仅为非运行时代码」放宽
- **验证脚本的依赖组件必须入库**：`_verify_invite.mjs` 依赖 `_invite_child.mjs`，曾误删导致 18 项 MODULE_NOT_FOUND。**清理临时文件前先确认没有脚本 import 它**
- **截图时数据要自洽**：跑截图脚本前先确认 `metadata.json` 与磁盘文件一致（种子脚本按「以磁盘为准」生成），
  否则页面会出现「文件名与文件数对不上」的空壳行

### 真实浏览器测试模板（可复用）
Chrome：`C:\Program Files\Google\Chrome\Application\chrome.exe`。无 puppeteer/playwright，
用 **CDP over 原生 WebSocket**（Node 22 内置 `WebSocket`）：
1. `spawn chrome --headless=new --remote-debugging-port=PORT --user-data-dir=<临时> --disable-extensions`，
   轮询 `GET http://127.0.0.1:PORT/json/version` 直到就绪
2. 连 **browser 级** ws（`version.webSocketDebuggerUrl`），调 `Target.createTarget {url:'about:blank'}`
   ⚠️ `/json/list` 初始可能只有 background_page，**必须自己建 target**
3. 从 `/json/list` 找该 `targetId` 的 `webSocketDebuggerUrl`，连**页面级** ws
4. `Page.enable` + `Runtime.enable`
5. **注入登录态**（关键）：`Page.addScriptToEvaluateOnNewDocument` 覆写 `window.fetch`，
   让 `/api/auth/me` 返回已登录用户、`/api/account/workspace` 返回团队数据，
   否则 `/workspace` 只渲染「登录后使用团队空间」，量不到目标元素
6. `Emulation.setDeviceMetricsOverride {width,height,deviceScaleFactor:1}` → `Page.navigate` → 等 ~2s →
   `Runtime.evaluate` 读 `getBoundingClientRect()` / `getComputedStyle()`
7. `Page.captureScreenshot {format:'png', captureBeyondViewport:true}` 出 PNG 肉眼复核
8. 收尾：`chrome.kill()` + 删临时 `--user-data-dir`（`spawn` 时记得消费 stdout/stderr，见 §C 死锁坑）

> Playwright 亦可直接用于截图：`...\node_modules\@playwright\cli\node_modules\playwright-core`，
> chromium `C:\Users\admin\AppData\Local\ms-playwright\chromium-1228\chrome-win64\chrome.exe`

## D. Git / 部署（双远程 + 事故恢复）

### D.1 双远程与部署链路
| remote | 地址 | 作用 |
|---|---|---|
| `origin` | `https://gitee.com/zhanlinhai/kunqiong-file-transfer-web.git` | 代码镜像，**不触发部署** |
| `gitea` | `http://43.154.197.96/giteaadmin/...` | **推这里才触发 CI**（`.gitea/workflows/deploy-test.yml`） |

- 触发条件：`push` 到 `main` 或手动 `workflow_dispatch`；CI 在 runner 上 `git clone` → 跑 `scripts/deploy-test.sh`
- ⚠️ **CI 必须 `runs-on: linux`**（固定本机 runner）。写成 `ubuntu-latest` 会被 `43.138.35.163` 上的同名 runner 抢走任务 → 看似成功实则部署到别处
- 部署生效判据：`http://43.154.197.96:8045/` 返回的 `assets/index-*.{css,js}` **hash 变了**。轮询 ~20s 一次，通常 1~3 分钟生效
- 验证线上产物用**宽松正则**：minifier 会改属性顺序、`rgba()` 转 hex、压缩变量名 →
  直接搜 `accountPlanIcon` 会 MISS。改搜 `.page-footer button{display:inline-flex`、
  文案字面量（`保存昵称`）等**压缩后仍保留**的特征

### D.2 ⚠️⚠️ rebase 被 SIGTERM 强杀会毁掉 `.git/objects`
**2026-09-19 真实事故**：`git rebase <sha>` 在 Bash 工具里超时 → 被 SIGTERM →
`.git/objects` 与 `refs/heads/main` **被清空**，`.git` 从 ~13MB 缩到 37KB。

- **症状**：`PWD` 与 `.git\HEAD` 都能读，但**任何 git 命令都报 `fatal: not a git repository`**
- **根因**：Bash 工具运行 git 时 `cd` 未真正生效 + rebase 中断的双重作用
- **兜底事实**：**工作区文件 100% 完好**（rebase 不动工作区）→ 损失可控，别慌

**恢复流程**（已实测有效）：
1. 先验证工作区完整：关键文件在、我的改动特征串在（如 `设计增强层 v1`）
2. 备份我的改动文件到项目外（`shutil.copy2`）
3. `git clone <gitea-url> <桌面临时目录>` 拿干净 `.git`
4. 对比远端与工作区：**按 `\r\n`→`\n` 归一化后再比 md5** —— 否则 CRLF 差异会让人误判「远端版本是错的」
5. 移走损坏 `.git`（留作备份）→ 移入克隆的 `.git`
6. 重建 remote 配置（克隆来的只有 `origin` 指向 Gitea）：
   ```
   git remote set-url origin <gitee-url>
   git remote add gitea <gitea-url>
   git config core.autocrlf false && git config core.eol lf
   ```
7. ⚠️ **把被 rebase 改坏的文件 `git checkout --` 还原**：本次 `.gitea/workflows/deploy-test.yml`
   的工作区版本被回退成 `ubuntu-latest`，**必须还原**，否则部署跑错机器
8. ⚠️ **把 CRLF 转回 LF**：rebase 会把工作区文件转成 CRLF，导致 diff 显示「整文件重写」
   （`main.jsx` 虚报 13522 行）。逐字节 `b.replace(b'\r\n', b'\n')` 写回
9. 复核 `git diff --stat` 是否回到真实改动量，再提交

**预防**：
- 跑 `git rebase` / `git merge` 这类可能进交互或耗时的命令，**别用默认超时**，
  给它显式大超时；Bash 工具的 `cd` 在该环境不可靠，**能用 `subprocess(cwd=R)` 就不要靠 `cd`**
- 冲突面小时可考虑 `git merge` 或 `cherry-pick` 替代 rebase
- **推送前先备份 `.git`**（`robocopy /E` 或 `shutil.copytree`），13MB 成本极低

### D.3 推送被拒的正确判断顺序
1. `git fetch <remote> main` → 若 remote 是**全新引用**且 `git diff` 为空，**先别急着 pull**
2. 用 `git ls-remote <remote>` 拿**真实远端 sha**（`fetch` 有时拿不到）
3. `git cat-file -t <sha>` + `git log --oneline <sha>` 看远端到底有什么
4. `git merge-base HEAD <sha>` 找共同祖先 → 据此判断是 **fast-forward / 平行线 / 真正冲突**
5. 平行线且**改动文件无交集** → rebase（或 merge）；有交集 → 老老实实 merge 解冲突

