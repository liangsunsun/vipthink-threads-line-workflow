# VIPTHINK Threads 輿情與 LINE 推播

這個專案用於收集 VIPTHINK 在 Threads 上的相關公開討論，整理成摘要後透過 LINE Messaging API 推播。

## 功能

- 使用 Threads API 依關鍵字收集 VIPTHINK 相關公開貼文
- 支援手動補收 Threads 貼文網址
- 使用 Playwright 輔助探索 Threads 搜尋結果
- 將 Threads 輿情摘要推播到 LINE
- 提供週期檢查腳本，可搭配排程工具使用

## 安裝

```bash
npm install
```

如需使用瀏覽器探索 Threads URL：

```bash
npx playwright install chromium
```

## 設定

複製 `.env.example` 為 `.env`，再填入正式設定。

```bash
cp .env.example .env
```

`.env` 不可以提交到 GitHub。

必要欄位：

```env
THREADS_ACCESS_TOKEN=replace_with_threads_access_token
THREADS_USER_ID=replace_with_threads_user_id
BRAND_KEYWORDS=VIPTHINK,VIP Think,#VIPThink
LINE_CHANNEL_ACCESS_TOKEN=replace_with_line_channel_access_token
```

## 使用方式

收集 Threads 資料：

```bash
npm run collect:threads
```

發送 LINE 測試訊息：

```bash
npm run send:line:test
```

發送 Threads 摘要到 LINE：

```bash
npm run send:line:threads
```

執行完整週期流程：

```bash
npm run weekly:threads:line
```

## 手動補收 Threads URL

可以建立本機檔案：

```text
data/threads-manual-urls.txt
```

格式：

```text
# Manually curated Threads post URLs
https://www.threads.com/@example/post/example
```

`data/` 內的執行資料預設不會提交到 GitHub。

## 安全原則

- 不提交 `.env`
- 不提交真實 Token、Cookie、密碼、私鑰或憑證
- 不提交未脫敏 LINE 設定
- 不提交未脫敏 Threads 私訊、截圖、後台資料或原始匯出檔
- 可提交的資料只限程式碼、文件、模板、假設定與脫敏示例

## 交付內容

```text
scripts/collect-threads.mjs
scripts/discover-threads-browser.mjs
scripts/discover-threads-urls.mjs
scripts/send-line-threads-summary.mjs
scripts/send-line-test.mjs
scripts/weekly-threads-line-check.mjs
config/brand-aliases.json
.env.example
.gitignore
.github/pull_request_template.md
```
