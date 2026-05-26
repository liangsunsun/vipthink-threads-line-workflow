import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_PATH = path.join(DATA_DIR, "threads-posts.json");
const MANUAL_URLS_PATH = path.join(DATA_DIR, "threads-manual-urls.txt");

const DEFAULT_KEYWORDS = ["VIPTHINK", "VIPThink", "VIPthink", "VIP Think", "#VIPThink"];
const SEARCH_TYPES = ["RECENT", "TOP"];

function describeError(error) {
  if (!error) return "unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function redactUrl(input) {
  try {
    const url = new URL(String(input));
    if (url.searchParams.has("access_token")) {
      url.searchParams.set("access_token", "[redacted]");
    }
    return url.toString();
  } catch {
    return String(input);
  }
}

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`request failed for ${redactUrl(url)}: ${describeError(error)}`);
  }

  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  return { response, body };
}

function parseArgs(argv) {
  const args = {
    keywords: [],
    urls: [],
    includeMentions: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keyword" || arg === "-k") {
      args.keywords.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--url" || arg === "-u") {
      args.urls.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--no-mentions") {
      args.includeMentions = false;
    }
  }

  args.keywords = args.keywords.filter(Boolean);
  args.urls = args.urls.filter(Boolean);
  return args;
}

async function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const values = {};

  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return { ...values, ...process.env };
}

async function readManualUrls() {
  try {
    const text = await fs.readFile(MANUAL_URLS_PATH, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function splitKeywords(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function htmlDecode(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number.parseInt(number, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function metaContent(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return htmlDecode(match[1]).trim();
  }

  return "";
}

function normalizePost(raw, source) {
  const likes = Number(raw.like_count || raw.likes || 0);
  const replies = Number(raw.reply_count || raw.replies || 0);
  const reposts = Number(raw.repost_count || raw.reposts || 0);
  const quotes = Number(raw.quote_count || raw.quotes || 0);

  return {
    id: raw.id || raw.shortcode || raw.permalink || raw.url,
    shortcode: raw.shortcode || "",
    username: raw.username || "",
    timestamp: raw.timestamp || null,
    text: raw.text || "",
    permalink: raw.permalink || raw.url || "",
    source,
    metrics: {
      likes,
      replies,
      reposts,
      quotes,
      engagement: likes + replies + reposts + quotes,
    },
    collected_at: new Date().toISOString(),
  };
}

async function readExistingPosts() {
  try {
    const text = await fs.readFile(OUTPUT_PATH, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.posts) ? parsed.posts : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function savePosts(posts) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const sorted = [...posts].sort((a, b) => {
    const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return timeB - timeA || String(b.collected_at).localeCompare(String(a.collected_at));
  });

  await fs.writeFile(
    OUTPUT_PATH,
    JSON.stringify({ updated_at: new Date().toISOString(), posts: sorted }, null, 2),
  );
}

function mergePosts(existing, incoming) {
  const byKey = new Map();
  for (const post of existing) {
    byKey.set(post.id || post.permalink, post);
  }

  for (const post of incoming) {
    const key = post.id || post.permalink;
    const previous = byKey.get(key);
    byKey.set(key, { ...(previous || {}), ...post });
  }

  return [...byKey.values()];
}

async function searchKeyword({ keyword, searchType, token }) {
  const url = new URL("https://graph.threads.net/v1.0/keyword_search");
  url.searchParams.set("q", keyword);
  url.searchParams.set("search_type", searchType);
  url.searchParams.set("fields", "id,text,timestamp,permalink,username,like_count,reply_count,repost_count,quote_count");
  url.searchParams.set("access_token", token);

  const { response, body } = await fetchJson(url);

  if (!response.ok) {
    throw new Error(`keyword_search ${keyword} ${searchType} failed: ${body?.error?.message || response.status}`);
  }

  return (body.data || []).map((item) =>
    normalizePost(item, {
      type: "threads_keyword_search",
      keyword,
      search_type: searchType,
    }),
  );
}

async function fetchMentions({ userId, token }) {
  if (!userId) return [];

  const candidates = [
    `https://graph.threads.net/v1.0/${userId}/mentions`,
    "https://graph.threads.net/v1.0/me/mentions",
  ];
  const failures = [];

  for (const endpoint of candidates) {
    const url = new URL(endpoint);
    url.searchParams.set("fields", "id,text,timestamp,permalink,username,like_count,reply_count,repost_count,quote_count");
    url.searchParams.set("access_token", token);

    try {
      const { response, body } = await fetchJson(url);
      if (response.ok) {
        return (body.data || []).map((item) =>
          normalizePost(item, {
            type: "threads_mentions",
            endpoint,
          }),
        );
      }
      failures.push(`mentions endpoint ${endpoint} failed: ${body?.error?.message || response.status}`);
    } catch (_error) {
      failures.push(`mentions endpoint ${endpoint} failed`);
    }
  }

  throw new Error(failures.join("; "));
}

async function fetchHtml(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    throw new Error(`request failed for ${url}: ${describeError(error)}`);
  }
}

function summarizeWarnings(warnings) {
  if (warnings.length === 0) return [];
  return [...new Set(warnings)];
}

function parseThreadsUrl(url) {
  const decoded = decodeURIComponent(url);
  const username = decoded.match(/threads\.com\/@([^/]+)\//)?.[1] || "";
  const shortcode = decoded.match(/\/post\/([^/?#]+)/)?.[1] || "";
  return { username, shortcode };
}

async function collectUrl(url) {
  const response = await fetchHtml(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Threads brand monitor",
    },
  });

  if (!response.ok) {
    throw new Error(`URL fetch failed ${response.status}: ${url}`);
  }

  const html = await response.text();
  const { username, shortcode } = parseThreadsUrl(url);
  const description = metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description");
  const canonical = metaContent(html, "og:url") || url;

  return normalizePost(
    {
      id: shortcode || canonical,
      shortcode,
      username,
      text: description,
      permalink: canonical,
      timestamp: null,
    },
    {
      type: "threads_url_metadata",
      url,
    },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnv();
  const token = env.THREADS_ACCESS_TOKEN;

  if (!token) {
    throw new Error("THREADS_ACCESS_TOKEN is missing in .env");
  }

  const envKeywords = splitKeywords(env.BRAND_KEYWORDS);
  const keywords = [...new Set([...(args.keywords.length ? args.keywords : envKeywords), ...DEFAULT_KEYWORDS])];
  const manualUrls = await readManualUrls();
  const urls = [...new Set([...args.urls, ...manualUrls])];
  const collected = [];
  const warnings = [];

  for (const keyword of keywords) {
    for (const searchType of SEARCH_TYPES) {
      try {
        const posts = await searchKeyword({ keyword, searchType, token });
        collected.push(...posts);
      } catch (error) {
        warnings.push(error.message);
      }
    }
  }

  if (args.includeMentions) {
    try {
      collected.push(...(await fetchMentions({ userId: env.THREADS_USER_ID, token })));
    } catch (error) {
      warnings.push(`mentions fetch failed: ${error.message}`);
    }
  }

  for (const url of urls) {
    try {
      collected.push(await collectUrl(url));
    } catch (error) {
      warnings.push(error.message);
    }
  }

  const existing = await readExistingPosts();
  const posts = mergePosts(existing, collected);
  await savePosts(posts);

  const summary = {
    keywords,
    urls,
    collected_this_run: collected.length,
    total_saved: posts.length,
    output: OUTPUT_PATH,
    warnings: summarizeWarnings(warnings),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
