# Fork 改动清单（blankGMY/goose，分支 custom/pool-page）

本文档记录本 fork 相对上游 Goose 的全部改动，供日后上游更新 rebase 时逐项重打。
策略：新文件 + 最小挂接行，尽量不改上游原代码；不可避免的上游小改动保持最小并可清单化重打。

> 最后更新：2026-11-23（新增第 4 节：codex 缓存亲和）。带「待补」标记的条目细节尚未整理完。

---

## 1. 确定性工具结果剪枝 + 摘要走便宜模型（提交 fd4f8b0）

目的：复现 Hermes 式剪枝。Goose 内核原有的工具对摘要（ToolPairCompactionOperation）触发门槛约 28 次工具调用、摘要本身烧旗舰模型调用、且只剪工具对不剪粘贴正文，对长会话基本无效。本改动新增一个确定性、零模型调用、按体积触发的剪枝操作，与现有摘要机制并存。

### 改动文件（共 6 个）

| 文件 | 动作 | 规模 / 说明 |
|---|---|---|
| `crates/goose/src/agents/state_machine/ops_tool_pruning.rs` | 新增 | 剪枝操作本体，约 211 行。`ToolPruningOperation`：按 JSON 线长估体积（as_concat_text 会漏统计工具结果，此坑已修并写进代码注释），超预算时把保护尾之外的最旧大工具对隐藏并留一条占位说明 |
| `crates/goose/src/context_mgmt/mod.rs` | 新增 | 选择函数 `tool_ids_to_prune`（按体积 + 年龄选对）与占位符生成，约 60 行 |
| `crates/goose/src/agents/state_machine/mod.rs` | 挂接 | 注册新模块，+2 行 |
| `crates/goose/src/agents/state_machine_builder.rs` | 挂接 | 在 `tool_pair_compaction` 之前挂入新操作，约 +8 行；透传 `summary_model` 与 4 个剪枝参数 |
| `crates/goose/src/agents/services.rs` | 挂接 | 读新配置键并传入 builder，约 +10 行；摘要模型读取与回退逻辑 |
| `crates/goose/src/agents/state_machine/tests/pipeline.rs` | 测试 | 新增 4 个剪枝测试：最旧一对先剪且到目标即停、目标大时两对同剪、保护尾覆盖被保护轮内工具对、小工具对不剪 |

机制要点：

- 复用现有 `ConversationEffect::SetMessageVisibility`：原消息只对 agent 隐藏（`agent_visible=false`），用户界面照常可见、数据库原文不改；插入一条确定性占位消息（工具名 + 原字符数）。
- 保护规则：最近 `GOOSE_PRUNE_KEEP_TURNS` 轮不剪；第一条用户消息永不剪；单条小于 `GOOSE_PRUNE_MIN_CHARS` 字符不剪；与现有摘要操作互不重叠处理同一消息（摘要跳过已隐藏消息，剪枝在前、摘要在后）。
- 触发：按估算 token 超 `GOOSE_PRUNE_TOKEN_BUDGET` 时批量执行，分摊提示缓存损失；只在超预算时动手，不逐轮扰动缓存。
- 子代理会话共用同一状态机，自动受益。

### 新增配置键（`~/.config/goose/config.yaml` 顶层）

| 键 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `GOOSE_SUMMARY_MODEL` | string | （未设） | 主压缩与工具对摘要改走的模型；未设时回退到 `GOOSE_SUBAGENT_MODEL`，再未设则用会话模型。现行配置回退到 `gpt-6-luna` |
| `GOOSE_PRUNE_ENABLED` | bool | `false` | 剪枝总开关，默认关闭，需显式开 |
| `GOOSE_PRUNE_TOKEN_BUDGET` | int | `60000` | 工具结果体积软预算（估算 token），超了才批量剪 |
| `GOOSE_PRUNE_MIN_CHARS` | int | `2000` | 单条工具结果小于此字符数不剪 |
| `GOOSE_PRUNE_KEEP_TURNS` | int | `3` | 保护最近 N 轮工具对不剪 |

回退行为：`GOOSE_SUMMARY_MODEL` 为空或未设 → 取 `GOOSE_SUBAGENT_MODEL`；两者都未设 → 摘要仍用会话模型（与改动前一致）。剪枝开关默认关，`GOOSE_PRUNE_ENABLED: true` 才生效。

### 验证方法

- 编译：`cargo check` 零错误；相关测试 29 项全过（含新增 4 个剪枝测试）；clippy 自有代码零警告（唯一警告是上游 `config/base.rs` 被本机新版 clippy 1.100 挑的 `needless_bool`，与本改动无关）。
- 部署实测（2026-11-23，见第 3 节）：新二进制在 Pi 上 `goose-serve` 正常启动，零模型调用 ACP 探针（initialize + session/new + session/close）通过。
- 效果验证（待真实胖会话）：ACP 探针造胖工具结果会话，对比开关前后 `usage_ledger` 的单轮 input_tokens 与缓存命中；再在真实长会话上观察新轮次。**本轮只验证功能就位，不宣称节省数字。**

### 回滚办法

- 停用剪枝：`GOOSE_PRUNE_ENABLED` 改 `false` + `sudo systemctl restart goose-serve` 即完全停用；数据零改动，无需迁移（可见性是消息元数据，原文一直在库里）。
- 换回官方二进制：`cp ~/goose/goose-official-1.60.2.bak ~/goose/goose` 后重启 `goose-serve`。备份位置见第 3 节。

---

## 2. Pi 构建流水线 build-pi.yml（提交 f6a58c9）

- 文件：`.github/workflows/build-pi.yml`。
- 触发条件：`push`（路径限定为工作流文件本身）与 `workflow_dispatch` 手动触发。
- 构建环境：GitHub 原生 ARM runner（`ubuntu-24.04-arm`），`cargo build --release --target aarch64-unknown-linux-gnu -p goose-cli --bin goose`，**全默认特性（含 local-inference）**。
- 产物位置：滚动 Release，标签 `pi-build`（`https://github.com/blankGMY/goose/releases/tag/pi-build`），资产 `goose-aarch64-unknown-linux-gnu.tar.gz` 与同名 `.sha256`；每次成功构建覆盖上传，Release 说明写明来源 commit 与构建时间。
- 首跑：run #1（id 45066242416，head `f6a58c9`），2026-11-22 20:24 UTC 触发、20:40 UTC 成功。
- 保底路线：本地沙箱 zig cc 交叉编译（`~/workspace/goose-pruning/` 下 `zigcc.sh` 等包装器 + `cargo-aarch64*.log`），**缺 local-inference 组件**（交叉编译需 libclang 生成绑定，改走去掉该特性重编；其余 15 个默认特性全保留，Pi 不跑本地模型故无影响）。另有两个已知坑已记入包装器：boa_engine 链接时传 `-Wl,--fix-cortex-a53-843419`，zig 链接器不认，需在 wrapper 里把裸形式与 `-Wl,` 前缀形式都剥掉。

---

## 3. 部署记录

### 2026-11-23 04:46 CST：剪枝版首次部署到 Pi

- 二进制来源：**CI 全功能版**（`binary_source=ci`）。GitHub Actions run 45066242416，conclusion=success，head `f6a58c9e447d89dc922884d768e825e4dbb21baf`；Release `pi-build` 资产 `goose-aarch64-unknown-linux-gnu.tar.gz`（64,707,170 字节），sha256 `4fb1f1f7bc95a8a926a2ff47766c67e8fc9347576b766c5db05efa0bacf19881`，校验通过。解出二进制 sha256 `dfa7ec5c956167c1789e32c4d3e68da4d85b5bd5f029cb51bb78d274840cdf79`，Pi 上 `--version` 输出 `1.60.0`（fork 基线版本串）。
- 备份位置（Pi，`~/goose/` 与 `~/.config/goose/`）：
  - 官方二进制备份：`~/goose/goose-official-1.60.2.bak`（199,216,392 字节，原 1.60.2）
  - 配置备份：`~/.config/goose/config.yaml.bak-prune-deploy`
  - 网关备份：`~/goose-web/goose-web-proxy.py.bak-prune-deploy`
- 配置：`GOOSE_PRUNE_ENABLED: true` 已追加到 `config.yaml` 末尾；其余剪枝键未显式设，用默认值（预算 60000 / 最小 2000 字符 / 保护 3 轮）；`GOOSE_SUMMARY_MODEL` 未设，回退 `GOOSE_SUBAGENT_MODEL=gpt-6-luna`。
- 验证：`goose-serve` 重启后 `active`、NRestarts=0、无崩溃循环；零模型调用 ACP 探针通过（initialize + session/new + session/close，会话 `20261122_100`）。
- 同批部署的设置页（阶段 3）：网关新版 `goose-web-proxy.py` 已替换并重启 `goose-web`（active）；网页 UI 产物同步到 `~/acp-ui-web` 与 `~/acp-ui-web-patched` 两个根目录；走网关登录流验证首页 bundle 为新版 `assets/index-D0kHjZLs.js`（8081 与 8083 一致），`GET /api/context-settings` 返回 11 个键，`GOOSE_PRUNE_ENABLED` 读回为 `true`；acp-ui-build 本地已提交 `56ad1ba`（ContextPage 等）。
- 剪枝实际省额度效果待真实胖会话跑起来后看 `usage_ledger`，本轮不编造节省数字。

---

## 4. chatgpt_codex 缓存亲和：session-id 头 + prompt_cache_key（2026-11-23）

目的：修复 GPT 订阅通道提示缓存几乎不命中（实测会话续接调用零命中率约 85%）。上游 issue #13609 实测：该 provider 不发任何后端可用的会话亲和标识；Codex 官方客户端靠 `session-id` 头建立缓存亲和（openai/codex client.rs 注释原文 "ChatGPT derives cache affinity from the Responses session-id header"），并以会话 id 派生 `prompt_cache_key`。本 fork 原有通用机制发的头名是内部用的 `agent-session-id`，后端不认；请求体也无 `prompt_cache_key`。

### 改动文件（共 1 个）

| 文件 | 动作 | 说明 |
|---|---|---|
| `crates/goose/src/providers/chatgpt_codex.rs` | 修改 | `create_codex_request`：会话作用域内（`crate::session_context::current_session_id()` 有值时）在 payload 顶层加 `prompt_cache_key` = 会话 id；`post_streaming`：同一 id 加字面名 `session-id` 的 HTTP 头。作用域外不发，保持原行为兜底。新增 2 个单元测试（无会话时不带键、会话内键值等于会话 id） |

### 验证方法

- 本地：`cargo test -p goose --lib providers::chatgpt_codex` 全过（含新增 2 测试）。
- 部署后实测：ACP 探针建一个 GPT 会话、发一条会触发多次顺序工具调用的短任务，读 `usage_ledger` 该会话各行 `cache_read_tokens`：续接调用应不再大面积为 0。后端偶发零命中在上游报告中修复后仍存在，验收看零命中率与缓存占比的整体变化，不要求 100%。

### 回滚办法

- 换回上一版二进制（部署时在 Pi `~/goose/` 留 `.bak` 备份）后重启 `goose-serve`；或回退本文件后走 CI 重编。无配置键、无数据迁移。

---

## 5. 此前几批 fork 改动（条目位置，待补细节）

以下条目先占位，逐项补齐文件清单、提交、配置键与验证方法后再删此行。

- [ ] 号池页（PoolPage / pool 扩展 + MCP 应用面板）——待补
- [ ] 会话删除（工作区删除 + healSessionIdCounter，删最新会话后推过毒编号）——待补
- [ ] 模型清单合并（桌面端模型/推理选择对齐网页端，含清单外 Codex 模型与自定义模型偏好）——待补
- [ ] 技能与记忆页（桌面端技能管理、记忆管理页）——待补
- [ ] 桌面交接按钮（HandoffButton + bot_handoff_package/status 工具）——待补
- [ ] healSessionIdCounter（见会话删除条；独立成条亦可）——待补
