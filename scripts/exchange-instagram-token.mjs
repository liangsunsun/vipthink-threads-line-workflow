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

function setEnvValue(text, name, value) {
  const line = `${name}=${value}`;
  if (new RegExp(`^${name}=.*$`, "m").test(text)) {
    return text.replace(new RegExp(`^${name}=.*$`, "m"), line);
  }
  return `${text.replace(/\s*$/, "")}\n${line}\n`;
}

async function exchangeInstagramLoginToken({ token, appSecret }) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("access_token", token);

  const response = await fetch(url);
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok || !body.access_token) {
    const message = body?.error?.message || body?.raw || `HTTP ${response.status}`;
    throw new Error(`Instagram token exchange failed: ${message}`);
  }
  return body;
}

async function refreshInstagramLoginToken({ token }) {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);

  const response = await fetch(url);
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  if (!response.ok || !body.access_token) {
    const message = body?.error?.message || body?.raw || `HTTP ${response.status}`;
    throw new Error(`Instagram token refresh failed: ${message}`);
  }
  return body;
}

async function main() {
  const envText = await loadEnvText();
  const accessToken = getEnvValue(envText, ["INSTAGRAM_ACCESS_TOKEN", "IG_ACCESS_TOKEN"]);
  const instagramAppSecret = getEnvValue(envText, ["INSTAGRAM_APP_SECRET"]);

  if (!accessToken.value) throw new Error("INSTAGRAM_ACCESS_TOKEN or IG_ACCESS_TOKEN is missing in .env");
  if (!instagramAppSecret.value) throw new Error("INSTAGRAM_APP_SECRET is missing in .env");

  let result;
  let instagramLoginError = null;
  let exchangeMethod = "instagram_login_exchange";

  try {
    result = await exchangeInstagramLoginToken({
      token: accessToken.value,
      appSecret: instagramAppSecret.value,
    });
  } catch (error) {
    instagramLoginError = error;
  }

  if (!result) {
    try {
      result = await refreshInstagramLoginToken({
        token: accessToken.value,
      });
      exchangeMethod = "instagram_login_refresh";
    } catch (error) {
      if (instagramLoginError) {
        throw new Error(`${instagramLoginError.message}; ${error.message}`);
      }
      throw error;
    }
  }

  if (!result) {
    throw instagramLoginError || new Error("Instagram token exchange failed");
  }

  let nextEnvText = setEnvValue(envText, "INSTAGRAM_ACCESS_TOKEN", result.access_token);
  const updated = ["INSTAGRAM_ACCESS_TOKEN"];

  if (result.expires_in) {
    const expiresAt = new Date(Date.now() + Number(result.expires_in) * 1000).toISOString();
    nextEnvText = setEnvValue(nextEnvText, "INSTAGRAM_TOKEN_EXPIRES_AT", expiresAt);
    updated.push("INSTAGRAM_TOKEN_EXPIRES_AT");
  }

  await fs.writeFile(ENV_PATH, nextEnvText);

  console.log(JSON.stringify({
    ok: true,
    updated,
    expires_in_days: result.expires_in ? Math.round(Number(result.expires_in) / 86400) : null,
    exchange_method: exchangeMethod,
    instagram_app_secret_source: instagramAppSecret.value ? instagramAppSecret.name : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
