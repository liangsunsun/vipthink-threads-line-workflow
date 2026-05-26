import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");

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

function buildTestMessage() {
  return [
    "LINE 測試訊息",
    `時間：${new Date().toISOString()}`,
    "用途：確認這台機器可連到 LINE Messaging API，且 token 可正常發送廣播。",
  ].join("\n");
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

async function main() {
  const env = await loadEnv();
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN is missing in .env");
  }

  const message = buildTestMessage();
  await sendBroadcast({ token: env.LINE_CHANNEL_ACCESS_TOKEN, message });

  console.log(JSON.stringify({
    ok: true,
    sent: true,
    type: "line_test_broadcast",
    preview: message,
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    sent: false,
    type: "line_test_broadcast",
    error: describeError(error),
  }, null, 2));
  process.exitCode = 1;
});
