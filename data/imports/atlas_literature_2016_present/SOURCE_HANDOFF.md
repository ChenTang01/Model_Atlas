# 四刊建模论文下载项目交接



> 继续 `C:/Users/TC/Desktop/Atlas_Literature_2016_present` 中的四刊建模论文收集。目标期刊只有 Management Science（MS）、Manufacturing & Service Operations Management（MSOM）、Marketing Science（MktS）和 Information Systems Research（ISR），时间为 2016-01-01 至当前目录快照截止日。不要修改或向 `C:/Users/TC/Desktop/Web/Atlas` 导入任何内容。先完成 `batch_2026-09-07_wave2` 中 41 份 PDF 的身份、版本、建模方法页和视觉核验；这些文件目前都是 pending，绝不能直接计入已纳入或打包。阅读根目录 `HANDOFF.md` 以及各刊 wave2 的 `summary.json`、`HANDOFF.md` 或 `review_progress.json` 后再行动。完成逐篇复核后，修正合并脚本对 `_wave2` 目录的识别，重新生成 master 清单，并建立新的 expanded 交付目录和压缩包；不得覆盖已经完成的 68 篇交付包。之后如继续补下载，只使用能与目标期刊 DOI、题名和全部作者精确对应的单篇公开作者稿、大学仓储、公开预印本或开放版本，记录来源与版本；不要把 SSRN 当作期刊范围，不要绕过登录、验证码、403、429 或订阅限制，也不要进行 EBSCO 系统性/批量下载。

## 1. 用户目标与判定口径

- 期刊：MS、MSOM、MktS、ISR。
- 年份：2016 年至今；当前 Crossref 快照截止 `2026-09-06`。
- modeling 的含义：论文必须有实质数学建模或理论方法贡献，例如博弈论与均衡、优化、随机过程、排队、动态规划、机制设计、算法及性能/误差界。
- 理论与数据、实验混合可以纳入。
- 不能因为摘要出现 `model`、`theory`、回归、结构估计或机器学习就自动纳入。纯实证、访谈、定性研究、单纯心理/行为实验及只把成熟模型当工具的文章应排除。
- 不物理删除元数据记录。错配 PDF 应从有效 manifest 移出并隔离，保留拒绝原因。
- 作者稿、工作论文、接受稿、预印本和正式版本必须分别标注；不能假设与最终出版版完全一致。

## 2. 已完成且可以信任的快照

根目录 master 与现有压缩包仍停留在 wave2 之前，未包含本次中断前新下载的 41 份文件。

| 项目 | 数量/状态 |
| --- | ---: |
| Crossref DOI 目录 | 7,362 |
| 有摘要字段 | 6,825 |
| 缺摘要 | 537 |
| 已存在于旧 Atlas、仅引用未复核 | 304 |
| master 中有效新 PDF | 69 |
| 已确认建模并打包 | 68 |
| master 中保守待审 | 1 |

68 篇已完成包按期刊为：MS 20、MSOM 15、MktS 26、ISR 7；共 2,645 页、74,997,187 个未压缩字节。

- 完成交付包：`outputs/Modeling_Papers_Public_Copies_2016_present_2026-09-07.zip`
- SHA-256：`944CBB2D69115B5AAFDD421E43F3B5B2BD8FA1A9F284282260FBF2A81664B547`
- 包内目录：`outputs/downloads_2026-09-07/`
- 当前统一目录：`catalog_master.json`
- 当前统一下载清单：`downloads_master.json`
- 当前统计：`summary.json`
- 获取尝试：`download_attempts_master.json`

现有 1 篇 master 待审是 `10.1287/mksc.2015.0929`，*Estimation of Beauty Contest Auctions*。已确认 PDF 身份和方法页，但其贡献可能主要是结构估计，因此没有勉强计入 68 篇包；下一位 agent 应按用户的“非纯 empirical”口径作最终判断。

## 3. wave2 中断状态：41 份，全部尚未进入 master

总计 41 份 PDF、1,902 页、78,071,375 字节。除下表所述的 provisional 阅读外，manifest 均保持 `needs_review`，这是有意的安全状态。

| 期刊 | PDF | 页数 | 字节 | 最终纳入完成 | 可利用的已有阅读 |
| --- | ---: | ---: | ---: | ---: | --- |
| MS | 19 | 977 | 37,143,007 | 0 | 仅完成签名、哈希、解析与页数审计；内容均待审 |
| MSOM | 11 | 462 | 29,184,563 | 0 | 7 篇已有 provisional 模型/定理页证据，4 篇待读；首页图未视觉检查 |
| MktS | 10 | 371 | 8,071,328 | 0 | 已抽取文本并渲染首页，但身份、版本及方法页均待人工复核 |
| ISR | 1 | 92 | 3,672,477 | 0 | 已读并视觉核验，provisional 为纳入；尚未写回最终 manifest |

### MS

- 目录：`MS/batch_2026-09-07_wave2/`
- 审计：`MS/batch_2026-09-07_wave2/summary.json`
- 详细交接及 11 个已发现但未下载的公开链接：`MS/batch_2026-09-07_wave2/HANDOFF.md`
- 19 个 PDF 的 DOI、题名、来源和 SHA-256：`MS/batch_2026-09-07_wave2/downloads.json`
- `verify_pdfs.py` 尚未执行；它会抽取页面并更新 page count。先阅读脚本再运行，原始 PDF 不要改写。
- 4 个 PDF 有解析器修复警告，必须渲染代表页检查。

### MSOM

- 目录：`MSOM/batch_2026-09-07_wave2/`
- 审计：`MSOM/batch_2026-09-07_wave2/summary.json`
- 逐篇 provisional 阅读：`MSOM/batch_2026-09-07_wave2/review_progress.json`
- 7 篇已读模型/定理页；4 篇的建议阅读页已列在 `review_progress.json`。
- 11 张首页 PNG 已生成但尚未由人工/视觉工具检查。完成代表性模型页渲染后才能写 final review。

### MktS

- 目录：`MktS/batch_2026-09-07_wave2/`
- 审计：`MktS/batch_2026-09-07_wave2/summary.json`
- 详细恢复说明、失败来源以及 4 个未下载候选链接：`MktS/batch_2026-09-07_wave2/HANDOFF.md`
- 页面文本索引：`MktS/batch_2026-09-07_wave2/review_text/index.json`
- 10 份均须逐篇核实题名、全部作者、稿件版本和实质建模贡献；尤其不能把纯结构估计或消费者行为研究仅因有模型而自动纳入。

### ISR

- 目录：`ISR/batch_2026-09-07_wave2/`
- 审计：`ISR/batch_2026-09-07_wave2/summary.json`
- 已有阅读证据：`ISR/batch_2026-09-07_wave2/review_progress.json`
- 论文：`10.1287/isre.2024.1518`，题名与 Yanan Wang、Yong Ge 两位作者相符；公开 arXiv 稿 `2604.21209`，92 页。
- 已读 PDF 第 1、13-24 页，已视觉检查第 1 与 22 页。第 18-23 页给出 DPO、课程学习、离线策略支持约束和 CVAE 目标，第 24 页给出性能界；provisional 判断为 `included_modeling`。
- 仍需把版本、`identity_check`、阅读范围及 `included_modeling` 写回 `downloads.json`，再进入 master。
- `browser_attempts.json` 记录了一次 SSRN 页面尝试：它对应 ISR DOI `10.1287/isre.2021.1011`，但没有任何 SSRN PDF 落盘。不要将它计为下载，也不要构造替代 Delivery URL。

## 4. 推荐恢复顺序

1. **先暂停新下载。** 把现有 41 份全部复核、清理和定案，避免扩大 pending 队列。
2. 阅读 PDF 处理技能：`C:/Users/TC/.codex/plugins/cache/openai-primary-runtime/pdf/26.904.11930/skills/pdf/SKILL.md`。
3. 对每份 PDF 完成以下核验：
   - `%PDF-` 签名、可解析、页数、实际 SHA-256 与 manifest 相同；
   - PDF 内题名和全部作者与目标 DOI 记录一致，记录合理的题名变体；
   - 标明 version of record / accepted manuscript / author manuscript / working paper / preprint 及日期依据；
   - 实际阅读完整的模型、假设、定理/命题/算法或方法页，记录 1-based PDF 页码与简洁证据；
   - 渲染并视觉检查首页和至少一张代表性模型页，确认公式/表格/字符可读；
   - 明确写入 `fulltext_review.decision`，只能使用真实完成的 `included_modeling`、排除决定或 `needs_review`；不要把 automated keyword screen 当人工复核。
4. 身份错配或损坏文件不要悄悄删除：设置 `valid_target_pdf: false` 或 `identity_mismatch: true`，写入 `rejected_downloads.json`，再用可恢复方式隔离准确文件。
5. 四刊 wave2 全部定案后再修改并运行 `tools/combine_catalogs.mjs`。
6. 合并后创建新的 expanded 交付目录/ZIP，并验证清单、文件数、页数、SHA-256 和 ZIP CRC；保留旧 68 篇包不变。
7. 完成 wave2 后，才从 MS 与 MktS 的 `HANDOFF.md` 中继续处理“已发现但未下载”的明确公开链接，并对 master DOI 去重。

## 5. 合并脚本的已知问题

`tools/combine_catalogs.mjs` 当前只识别：

```js
/^batch_\d{4}-\d{2}-\d{2}$/
```

因此它会忽略 `batch_2026-09-07_wave2`。最终复核完成后改成能识别带 wave 后缀的模式，例如：

```js
/^batch_\d{4}-\d{2}-\d{2}(?:_wave\d+)?$/
```

该脚本会校验 PDF 签名、SHA-256、page count、重复 DOI 和 review 状态；如果 manifest 仍为 pending，本应让它失败，不要删除这些断言来“通过”。当前 master 的 `fulltext_review` 是字符串，批次 manifest 的 `fulltext_review` 是对象，保持现有转换逻辑。

`tools/prepare_delivery.mjs` 把输出硬编码为 `outputs/downloads_2026-09-07`，而且拒绝覆盖。不要改写旧目录；请参数化或复制为新的 expanded 输出，例如：

```text
outputs/downloads_2026-09-07_expanded/
outputs/Modeling_Papers_Public_Copies_2016_present_2026-09-07_expanded.zip
```

## 6. 本机工具

- Python：`C:/Users/TC/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`
- Node：`C:/Users/TC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
- Poppler：`C:/Users/TC/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe`
- 统一合并脚本：`tools/combine_catalogs.mjs`
- 交付构建脚本：`tools/prepare_delivery.mjs`

在 PowerShell 中，从根目录运行脚本；不要直接重跑 wave2 的 `fetch` / `download` 脚本，除非任务已明确恢复到新增下载阶段且已先去重。

**下载手段**：使用多Agent控制chrome打开https://search.ebscohost.com/，点开第一个Ebsco Host DataBase，搜索对应文章，下载相关文章。使用多个agent同时打开多个网页一起下载。

## 7. Atlas 隔离要求

这个任务只处理下载目录。没有把新论文加入 Atlas，也没有移动、覆盖或删除 Atlas 现有 PDF。继续工作时不得修改：

```text
C:/Users/TC/Desktop/Web/Atlas
```

不要把这些 PDF 提交到 `Model_Atlas` 或任何公开仓库。等用户另行要求“导入 Atlas”后，再建立经过筛选的元数据/向量化流程。

## 8. 完成定义

只有同时满足以下条件才可向用户称为“本轮完成”：

- wave2 每份 PDF 已有最终身份、版本、建模资格和页面证据；
- 所有排除/错配/待审都在 manifest 中诚实保留；
- master 成功合并且统计可复算；
- 新 expanded 包不覆盖旧包，ZIP 完整性和 SHA-256 已验证；
- 给用户报告本轮新增纳入数、累计数、四刊分布，以及仍无公开全文/仍待处理的范围；
- 没有修改 Atlas 或公开发布 PDF。
- 完成后清理所有文件，只保留：一个pdf文件夹：里面有所有的下载的论文（文件重命名为标题名），以及相关的元文件（bibtex，下载失败的文件等）。
