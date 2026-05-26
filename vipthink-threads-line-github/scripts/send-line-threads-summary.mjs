import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const DATA_PATH = path.join(ROOT, "data", "threads-posts.json");

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

function buildMessage(db) {
  const posts = Array.isArray(db.posts) ? db.posts : [];
  const officialPosts = posts.filter((post) => post.username === "vipthink.tw");
  const nonOfficialPosts = posts.filter((post) => post.username && post.username !== "vipthink.tw");
  const latestOfficial = officialPosts[0];
  const latestNonOfficial = nonOfficialPosts[0];

  const lines = [
    "Threads 評論搜尋摘要",
    `更新時間：${db.updated_at || "unknown"}`,
    `總筆數：${posts.length}`,
    `官方貼文：${officialPosts.length}`,
    `非官方貼文：${nonOfficialPosts.length}`,
    "",
  ];

  if (latestOfficial) {
    lines.push("最新官方貼文");
    lines.push(`@${latestOfficial.username}`);
    lines.push(summarizeText(latestOfficial.text, 90));
    lines.push(latestOfficial.permalink || "");
    lines.push("");
  }

  if (latestNonOfficial) {
    lines.push("最新非官方提及");
    lines.push(`@${latestNonOfficial.username}`);
    lines.push(summarizeText(latestNonOfficial.text, 120));
    lines.push(latestNonOfficial.permalink || "");
    lines.push("");
  } else {
    lines.push("目前沒有抓到非官方提及。");
    lines.push("");
  }

  lines.push("資料來源：Threads API 關鍵字搜尋 + 手動貼文網址補收");
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

  const db = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  const message = buildMessage(db);
  await sendBroadcast({ token: env.LINE_CHANNEL_ACCESS_TOKEN, message });
  console.log(JSON.stringify({ ok: true, sent: true, preview: message }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
