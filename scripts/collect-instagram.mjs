import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_PATH = path.join(DATA_DIR, "instagram-posts.json");
const GRAPH_VERSION = "v22.0";

const DEFAULT_HASHTAGS = ["VIPThink", "VIPTHINK"];

function parseArgs(argv) {
  const args = {
    hashtags: [],
    urls: [],
    includeTop: true,
    includeOwnMedia: true,
    limit: 25,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--hashtag" || arg === "-t") {
      args.hashtags.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--url" || arg === "-u") {
      args.urls.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--limit") {
      args.limit = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--recent-only") {
      args.includeTop = false;
    } else if (arg === "--no-own-media") {
      args.includeOwnMedia = false;
    }
  }

  args.hashtags = args.hashtags.filter(Boolean);
  args.urls = args.urls.filter(Boolean);
  if (!Number.isFinite(args.limit) || args.limit <= 0) args.limit = 25;
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

function splitList(value) {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeHashtag(value) {
  return value.replace(/^#/, "").replace(/\s+/g, "").trim();
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

function parseInstagramUrl(url) {
  const decoded = decodeURIComponent(url);
  const username = decoded.match(/instagram\.com\/([^/?#]+)\//)?.[1] || "";
  const shortcode = decoded.match(/\/(?:p|reel|tv)\/([^/?#]+)/)?.[1] || "";
  return { username, shortcode };
}

function normalizePost(raw, source) {
  const likes = Number(raw.like_count || raw.likes || 0);
  const comments = Number(raw.comments_count || raw.comments || 0);

  return {
    id: raw.id || raw.shortcode || raw.permalink || raw.url,
    shortcode: raw.shortcode || "",
    username: raw.username || "",
    timestamp: raw.timestamp || null,
    text: (raw.caption || raw.text || "").replace(/\s+/g, " ").trim(),
    permalink: raw.permalink || raw.url || "",
    media_type: raw.media_type || "",
    source,
    metrics: {
      likes,
      comments,
      engagement: likes + comments,
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

async function graphGet(pathname, params) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const response = await fetch(url);
  const body = await response.json().catch(async () => ({ raw: await response.text() }));

  if (!response.ok) {
    throw new Error(`${pathname} failed: ${body?.error?.message || response.status}`);
  }

  return body;
}

async function getHashtagId({ hashtag, igUserId, token }) {
  const body = await graphGet("ig_hashtag_search", {
    user_id: igUserId,
    q: hashtag,
    access_token: token,
  });

  return body.data?.[0]?.id || null;
}

async function fetchHashtagMedia({ hashtagId, hashtag, edge, igUserId, token, limit }) {
  const body = await graphGet(`${hashtagId}/${edge}`, {
    user_id: igUserId,
    fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count",
    limit,
    access_token: token,
  });

  return (body.data || []).map((item) =>
    normalizePost(item, {
      type: `instagram_hashtag_${edge}`,
      hashtag,
      hashtag_id: hashtagId,
    }),
  );
}

async function fetchOwnMedia({ igUserId, token, limit }) {
  const body = await graphGet(`${igUserId}/media`, {
    fields: "id,caption,media_type,permalink,timestamp,like_count,comments_count,username",
    limit,
    access_token: token,
  });

  return (body.data || []).map((item) =>
    normalizePost(item, {
      type: "instagram_own_media",
    }),
  );
}

async function collectUrl(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Instagram brand monitor",
    },
  });

  if (!response.ok) {
    throw new Error(`URL fetch failed ${response.status}: ${url}`);
  }

  const html = await response.text();
  const { username, shortcode } = parseInstagramUrl(url);
  const description = metaContent(html, "og:description") || metaContent(html, "description") || metaContent(html, "twitter:description");
  const canonical = metaContent(html, "og:url") || url;

  return normalizePost(
    {
      id: shortcode || canonical,
      shortcode,
      username,
      caption: description,
      permalink: canonical,
      timestamp: null,
    },
    {
      type: "instagram_url_metadata",
      url,
    },
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnv();
  const token = env.INSTAGRAM_ACCESS_TOKEN || env.IG_ACCESS_TOKEN;
  const igUserId = env.INSTAGRAM_USER_ID || env.IG_USER_ID;

  if (!token) {
    throw new Error("INSTAGRAM_ACCESS_TOKEN or IG_ACCESS_TOKEN is missing in .env");
  }
  if (!igUserId) {
    throw new Error("INSTAGRAM_USER_ID or IG_USER_ID is missing in .env");
  }

  const envHashtags = splitList(env.INSTAGRAM_HASHTAGS || env.IG_HASHTAGS || env.BRAND_KEYWORDS);
  const hashtags = [...new Set([...(args.hashtags.length ? args.hashtags : envHashtags), ...DEFAULT_HASHTAGS].map(normalizeHashtag).filter(Boolean))];
  const collected = [];
  const warnings = [];

  for (const hashtag of hashtags) {
    try {
      const hashtagId = await getHashtagId({ hashtag, igUserId, token });
      if (!hashtagId) {
        warnings.push(`No Instagram hashtag id for ${hashtag}`);
        continue;
      }

      collected.push(...(await fetchHashtagMedia({ hashtagId, hashtag, edge: "recent_media", igUserId, token, limit: args.limit })));
      if (args.includeTop) {
        collected.push(...(await fetchHashtagMedia({ hashtagId, hashtag, edge: "top_media", igUserId, token, limit: args.limit })));
      }
    } catch (error) {
      warnings.push(error.message);
    }
  }

  if (args.includeOwnMedia) {
    try {
      collected.push(...(await fetchOwnMedia({ igUserId, token, limit: args.limit })));
    } catch (error) {
      warnings.push(error.message);
    }
  }

  for (const url of args.urls) {
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
    hashtags,
    urls: args.urls,
    collected_this_run: collected.length,
    total_saved: posts.length,
    output: OUTPUT_PATH,
    warnings,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
