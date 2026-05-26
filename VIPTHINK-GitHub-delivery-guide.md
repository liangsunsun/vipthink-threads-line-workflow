# VIPTHINK Threads 輿情與 LINE 串接 GitHub 交付規範

本文檔用於將 VIPTHINK 的 Threads 輿情相關執行、LINE 串接流程、文件與可交付素材整理成公司同仁可在 GitHub 使用的專屬工作倉庫。

## 1. 交付目標

建立一個 VIPTHINK 專用、私有、可審核、可版本管理的 GitHub 倉庫，用於管理：

- Threads 輿情監測與整理流程
- Threads 內容蒐集、標記、分類與回報規則
- LINE 串接流程、設定說明與維護文件
- 自動化腳本、範例設定與操作手冊
- 同仁可重複使用的回報模板與檢查清單
- 已脫敏或 fake data 的示例資料

GitHub 用來保存可維護的程式、文件、模板、流程與示例，不作為原始業務資料、帳號資訊或敏感資料的備份空間。

## 2. 適用範圍

本倉庫適用於 VIPTHINK 相關交付內容：

- Threads 輿情監測流程
- Threads 貼文蒐集與整理規則
- 輿情分類、標籤、摘要與回報格式
- LINE Notify、LINE Bot、LINE OA 或相關訊息串接文件
- LINE Webhook、推播、提醒、回報流程說明
- GitHub 上的文件、腳本、模板與範例資料
- 同仁操作手冊與交接文件

## 3. 不可放入 GitHub 的內容

以下內容不得提交到 GitHub：

- 真實帳號密碼
- API Key、Token、Cookie、私鑰、憑證
- 未脫敏的 LINE 使用者 ID、群組 ID、Webhook URL
- 未脫敏的 Threads 帳號資料、私訊、留言截圖或後台資料
- 真實學生、家長、客戶或合作方個資
- 合約、報價、訂單、付款、營收、成本或內部決策資料
- 原始 Excel、CSV、BI、CRM、後台、聊天工具或郵件匯出資料
- 未脫敏截圖、錄影、聊天紀錄、報表或日誌

需要示例時，請使用 fake data、遮蔽資料或公開來源資料。

## 4. 建議 GitHub 倉庫名稱

可擇一使用：

```text
vipthink-threads-line-workflow
vipthink-social-listening-line
vipthink-public-opinion-line-integration
```

建議設定：

- Visibility：Private
- Default branch：main
- main 分支不得直接修改
- 所有正式修改需透過 Pull Request
- 至少 1 位負責人審核後才能合併
- 禁止 force push 到 main
- 如帳號支援，開啟 secret scanning

## 5. 建議倉庫結構

```text
vipthink-threads-line-workflow/
  README.md
  docs/
    threads-monitoring-workflow.md
    line-integration-workflow.md
    operation-handover.md
  scripts/
    README.md
  templates/
    public-opinion-report-template.md
    pr-template.md
    issue-template.md
  examples/
    fake-threads-posts.json
    fake-line-message-payload.json
  config/
    config.example.yaml
  .env.example
  .gitignore
```

各資料夾用途：

| 資料夾 | 用途 |
| --- | --- |
| `docs/` | Threads 輿情與 LINE 串接的操作文件 |
| `scripts/` | 可交付的腳本或自動化工具說明 |
| `templates/` | 回報模板、PR 模板、Issue 模板 |
| `examples/` | fake data 或脫敏示例 |
| `config/` | 可公開的設定範例 |

## 6. README 建議內容

`README.md` 建議包含：

```markdown
# VIPTHINK Threads 輿情與 LINE 串接

本倉庫用於管理 VIPTHINK 的 Threads 輿情監測流程、LINE 串接文件、操作手冊、模板與示例資料。

## 內容

- Threads 輿情監測與整理流程
- LINE 串接與通知流程
- 操作交接文件
- 回報模板與檢查清單
- fake data 或脫敏示例

## 使用原則

- 不提交真實密鑰、Token、Cookie、私鑰或憑證
- 不提交未脫敏個資、私訊、留言截圖或後台資料
- 不提交原始匯出資料、帳務資料或內部決策資料
- 所有正式修改透過 Pull Request 審核後合併
```

## 7. `.gitignore` 建議內容

```gitignore
# Secrets
.env
.env.*
!.env.example
*.pem
*.key
*.p12
*.pfx
*.crt
*.cer
*.token
*.secret

# Local/private config
config/local.*
config/private.*
secrets/
private/

# Raw data and exports
data/raw/
exports/
downloads/
reports/private/
reports/tmp/
*.xlsx
*.xls
*.csv
*.tsv
*.zip
*.7z
*.rar

# Logs and system files
*.log
.DS_Store
Thumbs.db

# Dependencies and build outputs
node_modules/
__pycache__/
.pytest_cache/
dist/
build/
.venv/
venv/
```

## 8. `.env.example` 建議內容

`.env.example` 只能放欄位名稱與假值，不可放真實設定。

```env
LINE_CHANNEL_ACCESS_TOKEN=replace_with_line_channel_access_token
LINE_CHANNEL_SECRET=replace_with_line_channel_secret
LINE_WEBHOOK_URL=https://example.com/webhook
THREADS_SOURCE_LIST=example_account_1,example_account_2
REPORT_TIMEZONE=Asia/Taipei
```

## 9. PR 模板

建議建立 `.github/pull_request_template.md`：

```markdown
## 變更內容

- 

## 影響範圍

- [ ] Threads 輿情流程
- [ ] LINE 串接流程
- [ ] 文件或交接說明
- [ ] 腳本或設定範例
- [ ] 回報模板

## 驗證方式

- [ ] 文件已確認可閱讀
- [ ] 範例設定不含真實密鑰
- [ ] 腳本或流程已完成基本測試
- [ ] 相關連結、路徑或欄位已確認

## 安全檢查

- [ ] 沒有 `.env`、Token、Cookie、密碼、私鑰或憑證
- [ ] 沒有未脫敏 LINE 使用者 ID、群組 ID 或 Webhook URL
- [ ] 沒有未脫敏 Threads 帳號資料、私訊、留言截圖或後台資料
- [ ] 沒有真實學生、家長、客戶或合作方個資
- [ ] 沒有合約、報價、訂單、付款、營收、成本或內部決策資料
- [ ] 示例資料均為 fake data、脫敏資料或公開資料

## 是否需要負責人決策

- [ ] 不需要
- [ ] 需要，原因：
```

## 10. 同仁日常使用流程

```text
1. 拉取最新版本
2. 建立自己的分支
3. 修改 Threads 輿情、LINE 串接或相關交接文件
4. 檢查 changed files
5. 確認沒有真實密鑰、個資、截圖、原始匯出資料
6. 提交 commit
7. push 到 GitHub
8. 發 Pull Request
9. 負責人審核
10. 合併到 main
```

新人建議優先使用 GitHub Desktop 或 VS Code Source Control。

## 11. Commit 與分支命名

分支命名建議：

```text
docs/name-threads-monitoring-workflow
docs/name-line-integration-guide
feature/name-line-notification-script
fix/name-webhook-config-example
chore/name-update-gitignore
```

Commit 命名建議：

```text
docs: add Threads monitoring workflow
docs: update LINE integration guide
feature: add LINE notification example
fix: refine webhook config example
chore: update ignore rules
```

## 12. 上傳前檢查清單

每次 push 或發 PR 前，請確認：

- 修改內容是否屬於本次交付範圍
- 是否誤放 `.env`、Token、密碼、私鑰、Cookie
- 是否誤放 LINE 真實設定或 Webhook URL
- 是否誤放 Threads 私訊、留言截圖、後台資料
- 是否誤放個資、帳務資料或內部決策資料
- 是否誤放 Excel、CSV、ZIP、截圖、日誌或原始匯出檔
- README、文件與範例是否能讓同仁接手使用

如不確定是否可以上傳，先不要 push，請負責人確認。

## 13. 負責人初始化清單

建立 GitHub 倉庫後，負責人應檢查：

- [ ] 倉庫已設為 private
- [ ] README 已說明交付內容與使用原則
- [ ] 已建立 `.gitignore`
- [ ] 已建立 `.env.example`
- [ ] 已建立 PR 模板
- [ ] 已建立 `docs/`、`templates/`、`examples/`
- [ ] 示例資料為 fake data 或脫敏資料
- [ ] 沒有真實密鑰、Token、API Key、私鑰
- [ ] 沒有未脫敏 LINE 或 Threads 資料
- [ ] 沒有個資、帳務資料或內部決策資料
- [ ] main 分支已設定保護
- [ ] 至少 1 位負責人審核後才能合併 PR

## 14. 對內說明文字

可提供給公司同仁：

```text
這個 GitHub 倉庫用於 VIPTHINK 的 Threads 輿情監測、LINE 串接流程、操作文件、模板與脫敏示例。

請勿上傳真實密鑰、Token、Cookie、私鑰、LINE 真實設定、Threads 私訊或後台資料、個資、帳務資料、原始匯出檔、未脫敏截圖或日誌。

所有正式修改請透過分支與 Pull Request 提交，經負責人審核後再合併到 main。
```

## 15. 給主管的交付說明

可直接回覆主管：

```text
我已將 Threads 輿情相關執行與 LINE 串接內容整理成 VIPTHINK 專屬 GitHub 交付規範。

這份規範會建立一個 private GitHub 倉庫，用於保存 Threads 輿情流程、LINE 串接文件、操作交接、模板、腳本說明與脫敏示例。

倉庫會加入 .gitignore、.env.example、PR 模板、安全檢查表與資料邊界說明，避免同仁誤傳密鑰、Token、LINE 真實設定、Threads 私訊或後台資料、個資、帳務資料、原始匯出檔、未脫敏截圖或日誌。

同仁後續可使用 GitHub Desktop 或 VS Code 操作，透過分支與 Pull Request 提交，由負責人審核後再合併。
```

