import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const DATA_PATH = path.join(ROOT, "data", "threads-posts.json");
const RUN_LOG_PATH = path.join(ROOT, "data", "weekly-threads-line-memory.md");
const VIPTHINK_TERMS = ["vipthink", "vip think", "#vipthink"];
const POSITIVE_TERMS = ["喜歡", "推薦", "值得", "好玩", "滿意", "不錯", "優質", "進步"];
const NEGATIVE_TERMS = ["不買", "不爽", "疑慮", "問題", "不推", "拒絕", "割", "矮化", "慢走不送", "完全過不去"];

function describeError(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

async function loadEnv() {
  const values = {};
  const text = await fs.readFile(ENV_PATH, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return { ...values, ...process.env };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function summarizeText(text, maxLength) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function countTermMatches(text, terms) {
  return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
}

function scoreSentiment(text) {
  const normalized = String(text || "").toLowerCase();
  const positive = countTermMatches(normalized, POSITIVE_TERMS.map((term) => term.toLowerCase()));
  const negative = countTermMatches(normalized, NEGATIVE_TERMS.map((term) => term.toLowerCase()));
  const score = positive - negative;

  let label = "neutral";
  if (score > 0) label = "positive";
  if (score < 0) label = "negative";

  return { label, score };
}

function isVipThinkRelevant(post) {
  const sourceUrl = post.source?.url || "";
  const searchable = `${post.text || ""} ${post.permalink || ""} ${sourceUrl}`.toLowerCase();
  return VIPTHINK_TERMS.some((term) => searchable.includes(term));
}

function countBy(items, getter) {
  const counts = {};
  for (const item of items) {
    const key = getter(item) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildWeeklyReportMessage({ db }) {
  const allPosts = Array.isArray(db.posts) ? db.posts : [];
  const officialCount = allPosts.filter((post) => post.username === "vipthink.tw").length;
  const relevantNonOfficialPosts = allPosts
    .filter((post) => post.username && post.username !== "vipthink.tw")
    .filter(isVipThinkRelevant)
    .map((post) => ({
      ...post,
      sentiment: scoreSentiment(post.text),
    }));
  const sentimentBreakdown = countBy(relevantNonOfficialPosts, (post) => post.sentiment.label);
  const negativePosts = relevantNonOfficialPosts.filter((post) => post.sentiment.label === "negative");
  const positivePosts = relevantNonOfficialPosts.filter((post) => post.sentiment.label === "positive");
  const recentPosts = [...relevantNonOfficialPosts].sort((a, b) => {
    const timeA = new Date(a.timestamp || a.collected_at || 0).getTime();
    const timeB = new Date(b.timestamp || b.collected_at || 0).getTime();
    return timeB - timeA;
  });
  const lines = [
    "VIPTHINK 輿論週報",
    `更新時間：${db.updated_at || "unknown"}`,
    `總筆數：${allPosts.length}`,
    `官方貼文：${officialCount}`,
    `VIPTHINK 相關非官方貼文：${relevantNonOfficialPosts.length}`,
    `情緒分布：正向 ${sentimentBreakdown.positive || 0} / 中立 ${sentimentBreakdown.neutral || 0} / 負向 ${sentimentBreakdown.negative || 0}`,
    "",
  ];

  if (relevantNonOfficialPosts.length === 0) {
    lines.push("本週沒有找到與 VIPTHINK 相關的非官方評論。");
    lines.push("");
  } else {
    const headline = negativePosts.length > 0
      ? `本週重點：出現 ${negativePosts.length} 則負向 VIPTHINK 討論。`
      : positivePosts.length > 0
        ? `本週重點：有 ${positivePosts.length} 則正向 VIPTHINK 討論。`
        : "本週重點：有 VIPTHINK 討論，但情緒以中立為主。";
    lines.push(headline);
    lines.push("");

    const showcasePosts = (negativePosts.length > 0 ? negativePosts : recentPosts).slice(0, 3);
    lines.push(negativePosts.length > 0 ? "代表性評論" : "本週代表性評論");
    for (const post of showcasePosts) {
      lines.push(`@${post.username || "unknown"} (${post.sentiment.label})`);
      lines.push(summarizeText(post.text, 120));
      if (post.permalink) lines.push(post.permalink);
      lines.push("");
    }
  }

  lines.push("資料來源：Threads API 關鍵字搜尋 + 手動貼文網址補收（僅統計明確提及 VIPTHINK / VIP Think 內容）");
  return lines.join("\n").trim();
}

async function sendBroadcast({ token, message }) {
  let response;
  try {
    response = await fetch("https://api.line.me/v2/bot/message/broadcast", {
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
  } catch (error) {
    throw new Error(`LINE broadcast request failed: ${describeError(error)}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LINE broadcast failed (${response.status}): ${body}`);
  }
}

async function runCollection() {
  try {
    const result = await execFileAsync("node", ["scripts/collect-threads.mjs"], {
      cwd: ROOT,
      timeout: 180000,
    });

    return {
      ok: true,
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || "",
    };
  } catch (error) {
    return {
      ok: false,
      stdout: error.stdout?.trim() || "",
      stderr: error.stderr?.trim() || "",
      message: describeError(error),
    };
  }
}

function summarizeForLog(result) {
  const parts = [
    `ok=${result.ok}`,
    `sent=${result.sent}`,
    `relevant_non_official_mentions=${result.relevant_non_official_mentions ?? 0}`,
  ];

  if (result.failure_stage) parts.push(`failure_stage=${result.failure_stage}`);
  if (result.reason) parts.push(`reason=${result.reason}`);
  if (result.cached_data_updated_at) parts.push(`cached_data_updated_at=${result.cached_data_updated_at}`);
  if (result.error) parts.push(`error=${String(result.error).replace(/\s+/g, " ").trim()}`);

  return parts.join(", ");
}

async function appendRunLog(result) {
  const lines = [
    new Date().toISOString(),
    `- ${summarizeForLog(result)}`,
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(RUN_LOG_PATH), { recursive: true });
  await fs.appendFile(RUN_LOG_PATH, lines, "utf8");
}

async function outputResult(result) {
  await appendRunLog(result);
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const env = await loadEnv();
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is missing in .env");
  }

  const db = await readJson(DATA_PATH, { posts: [] });
  const collection = await runCollection();

  if (!collection.ok) {
    await outputResult({
      ok: false,
      sent: false,
      failure_stage: "collection",
      relevant_non_official_mentions: 0,
      cached_data_updated_at: db.updated_at || null,
      error: collection.stderr || collection.message,
      collector_stdout: collection.stdout || null,
    });
    process.exitCode = 1;
    return;
  }

  const refreshedDb = await readJson(DATA_PATH, { posts: [] });
  const relevantNonOfficialPosts = (refreshedDb.posts || [])
    .filter((post) => post.username && post.username !== "vipthink.tw")
    .filter(isVipThinkRelevant);
  const message = buildWeeklyReportMessage({ db: refreshedDb, posts: refreshedDb.posts || [] });
  try {
    await sendBroadcast({ token: env.LINE_CHANNEL_ACCESS_TOKEN, message });
  } catch (error) {
    await outputResult({
      ok: false,
      sent: false,
      failure_stage: "line_broadcast",
      relevant_non_official_mentions: relevantNonOfficialPosts.length,
      cached_data_updated_at: refreshedDb.updated_at || null,
      error: describeError(error),
      collector_stdout: collection.stdout || null,
      preview: message,
    });
    process.exitCode = 1;
    return;
  }

  await outputResult({
    ok: true,
    sent: true,
    reason: relevantNonOfficialPosts.length === 0 ? "weekly_report_sent_no_relevant_mentions" : "weekly_report_sent",
    relevant_non_official_mentions: relevantNonOfficialPosts.length,
    cached_data_updated_at: refreshedDb.updated_at || null,
    collector_stdout: collection.stdout || null,
    preview: message,
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
