import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const REPORT_PATH = path.join(ROOT, "data", "market-scan-report.json");

async function loadEnv() {
  const values = {};
  const text = await fs.readFile(ENV_PATH, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return { ...values, ...process.env };
}

function summarizeText(text, maxLength) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function formatDate(value) {
  if (!value) return "unknown";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function buildMessage(report) {
  const lines = [
    "社群市場輿情摘要",
    `產生時間：${formatDate(report.generated_at)}`,
    `掃描天數：${report.range?.days || "unknown"} 天`,
    `檢查關鍵字：${report.checked_keywords || 0}`,
    `有聲量議題：${report.topics_with_results || 0}`,
    "",
  ];

  const topics = Array.isArray(report.top_10) ? report.top_10.slice(0, 5) : [];
  if (topics.length === 0) {
    lines.push("這次沒有掃到可見聲量。");
  } else {
    lines.push("前幾名議題");
    for (const topic of topics) {
      const topPost = topic.top_posts?.[0];
      const platforms = Object.entries(topic.platform_breakdown || {})
        .map(([platform, count]) => `${platform} ${count}`)
        .join(" / ");
      const sentiment = topic.sentiment || {};
      lines.push(`${topic.keyword}：${topic.volume} 筆，負面 ${sentiment.negative || 0} 筆`);
      if (platforms) lines.push(platforms);
      if (topPost?.text) lines.push(summarizeText(topPost.text, 80));
      if (topPost?.permalink) lines.push(topPost.permalink);
      lines.push("");
    }
  }

  if (Array.isArray(report.timed_out) && report.timed_out.length > 0) {
    lines.push(`逾時查詢：${report.timed_out.length} 個`);
  }

  lines.push("資料來源：Threads API 搜尋 + IG/Threads 本地資料庫");
  return lines.join("\n").trim();
}

async function sendBroadcast({ token, message }) {
  const response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        {
          type: "text",
          text: message,
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE broadcast failed (${response.status}): ${body}`);
  }
}

async function main() {
  const env = await loadEnv();
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is missing in .env");
  }

  const report = JSON.parse(await fs.readFile(REPORT_PATH, "utf8"));
  const message = buildMessage(report);
  await sendBroadcast({ token: env.LINE_CHANNEL_ACCESS_TOKEN, message });
  console.log(JSON.stringify({ ok: true, sent: true, preview: message }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
