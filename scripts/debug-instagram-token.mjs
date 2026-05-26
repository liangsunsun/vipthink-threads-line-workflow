import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
const GRAPH_VERSION = "v22.0";

async function loadEnvText() {
  return fs.readFile(ENV_PATH, "utf8");
}

function getEnvValue(text, names) {
  for (const name of names) {
    const value = text.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1]?.trim();
    if (value) return { name, value };
  }
  return { name: names[0], value: "" };
}

function summarizeToken(token) {
  return {
    length: token.length,
    has_whitespace: /\s/.test(token),
    starts_with: token.slice(0, 6),
    ends_with: token.slice(-4),
  };
}

async function debugToken({ token, appId, appSecret }) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);

  const response = await fetch(url);
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok) {
    const message = body?.error?.message || body?.raw || `HTTP ${response.status}`;
    throw new Error(`Meta debug_token failed: ${message}`);
  }
  return body.data || body;
}

async function main() {
  const envText = await loadEnvText();
  const accessToken = getEnvValue(envText, ["INSTAGRAM_ACCESS_TOKEN", "IG_ACCESS_TOKEN"]);
  const appId = getEnvValue(envText, ["INSTAGRAM_APP_ID", "META_APP_ID", "FACEBOOK_APP_ID", "THREADS_APP_ID"]);
  const appSecret = getEnvValue(envText, ["INSTAGRAM_APP_SECRET", "META_APP_SECRET", "FACEBOOK_APP_SECRET", "THREADS_APP_SECRET"]);

  if (!accessToken.value) throw new Error("INSTAGRAM_ACCESS_TOKEN or IG_ACCESS_TOKEN is missing in .env");
  if (!appId.value) throw new Error("Add INSTAGRAM_APP_ID, META_APP_ID, FACEBOOK_APP_ID, or THREADS_APP_ID to .env");
  if (!appSecret.value) throw new Error("Add INSTAGRAM_APP_SECRET, META_APP_SECRET, FACEBOOK_APP_SECRET, or THREADS_APP_SECRET to .env");

  const debug = await debugToken({
    token: accessToken.value,
    appId: appId.value,
    appSecret: appSecret.value,
  });

  console.log(JSON.stringify({
    ok: true,
    token_shape: summarizeToken(accessToken.value),
    app_id_source: appId.name,
    token_app_id: debug.app_id || null,
    type: debug.type || null,
    application: debug.application || null,
    expires_at: debug.expires_at ? new Date(Number(debug.expires_at) * 1000).toISOString() : null,
    is_valid: debug.is_valid ?? null,
    scopes: debug.scopes || [],
    user_id: debug.user_id || null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
