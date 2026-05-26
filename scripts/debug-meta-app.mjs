import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, ".env");
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

async function main() {
  const envText = await loadEnvText();
  const appId = getEnvValue(envText, ["INSTAGRAM_APP_ID"]);
  const appSecret = getEnvValue(envText, ["INSTAGRAM_APP_SECRET"]);

  if (!appId.value) throw new Error("INSTAGRAM_APP_ID is missing in .env");
  if (!appSecret.value) throw new Error("INSTAGRAM_APP_SECRET is missing in .env");

  console.log(JSON.stringify({
    ok: true,
    app_id_source: appId.name,
    app_secret_source: appSecret.name,
    app_id_length: appId.value.length,
    app_secret_length: appSecret.value.length,
    note: "Instagram app id/secret cannot be validated with graph.facebook.com. Use instagram:token:exchange to validate them with an Instagram Login token.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
