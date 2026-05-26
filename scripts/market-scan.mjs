import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_PATH = path.join(DATA_DIR, "market-scan-report.json");
const LOCAL_SOURCE_PATHS = [
  { platform: "threads", path: path.join(DATA_DIR, "threads-posts.json") },
  { platform: "instagram", path: path.join(DATA_DIR, "instagram-posts.json") },
];

const DEFAULT_GROUPS = {
  VIPTHINK: ["VIPTHINK", "VIPThink", "VIP Think", "#VIPThink"],
};

const POSITIVE_TERMS = [
  "喜歡", "有效", "有感", "改善", "好用", "值得", "滿意", "安心", "方便", "順暢", "進步", "開心", "讚", "棒",
];

const NEGATIVE_TERMS = [
  "失望", "沒效", "沒什麼用", "無效", "難用", "抱怨", "問題", "不好", "不推", "踩雷", "退貨", "過敏", "副作用", "貴", "爛",
];

function parseArgs(argv) {
  const args = {
    days: 30,
    concurrency: 6,
    timeoutMs: 12000,
    groups: new Map(),
    includeTop: true,
    includeLocal: true,
    includeThreadsApi: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--days") {
      args.days = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--concurrency") {
      args.concurrency = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1]);
      index += 1;
    } else if (arg === "--group") {
      const value = argv[index + 1] || "";
      const [name, keywords = ""] = value.split(":");
      args.groups.set(name, keywords.split(",").map((item) => item.trim()).filter(Boolean));
      index += 1;
    } else if (arg === "--recent-only") {
      args.includeTop = false;
    } else if (arg === "--no-local") {
      args.includeLocal = false;
    } else if (arg === "--local-only") {
      args.includeThreadsApi = false;
    }
  }

  if (!Number.isFinite(args.days) || args.days <= 0) args.days = 30;
  if (!Number.isFinite(args.concurrency) || args.concurrency <= 0) args.concurrency = 6;
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) args.timeoutMs = 12000;

  return args;
}

async function loadEnv() {
  const envPath = path.join(ROOT, ".env");
  const values = {};
  const text = await fs.readFile(envPath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }

  return { ...values, ...process.env };
}

function getGroups(args) {
  if (args.groups.size === 0) return DEFAULT_GROUPS;
  return Object.fromEntries([...args.groups.entries()].filter(([, keywords]) => keywords.length > 0));
}

function buildRange(days) {
  const until = new Date();
  const since = new Date(until);
  since.setDate(since.getDate() - days);
  return { since, until };
}

async function readLocalPosts() {
  const posts = [];

  for (const source of LOCAL_SOURCE_PATHS) {
    try {
      const db = JSON.parse(await fs.readFile(source.path, "utf8"));
      if (!Array.isArray(db.posts)) continue;
      posts.push(
        ...db.posts.map((post) => ({
          ...post,
          platform: post.platform || source.platform,
        })),
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return posts;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function searchKeyword({ token, keyword, searchType, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL("https://graph.threads.net/v1.0/keyword_search");
    url.searchParams.set("q", keyword);
    url.searchParams.set("search_type", searchType);
    url.searchParams.set("fields", "id,text,timestamp,permalink,username,like_count,reply_count,repost_count,quote_count");
    url.searchParams.set("access_token", token);

    const response = await fetch(url, { signal: controller.signal });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: [],
        error: body?.error?.message || String(response.status),
      };
    }

    return {
      ok: true,
      status: response.status,
      data: Array.isArray(body.data) ? body.data : [],
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: [],
      error: error.name === "AbortError" ? "timeout" : error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizePost(item) {
  const likes = Number(item.like_count || 0);
  const replies = Number(item.reply_count || 0);
  const reposts = Number(item.repost_count || 0);
  const quotes = Number(item.quote_count || 0);
  const comments = Number(item.comments_count || item.metrics?.comments || 0);
  const metrics = item.metrics || {};
  const platform = item.platform || detectPlatform(item);
  const text = (item.text || item.caption || "").replace(/\s+/g, " ").trim();

  return {
    id: item.id,
    username: item.username || "",
    timestamp: item.timestamp || null,
    collected_at: item.collected_at || null,
    permalink: item.permalink || "",
    platform,
    text,
    source: item.source || { type: "threads_keyword_search" },
    sentiment: scoreSentiment(text),
    metrics: {
      likes: Number(metrics.likes || likes),
      replies: Number(metrics.replies || replies),
      reposts: Number(metrics.reposts || reposts),
      quotes: Number(metrics.quotes || quotes),
      comments,
      engagement: Number(metrics.engagement || likes + replies + reposts + quotes + comments),
    },
  };
}

function detectPlatform(post) {
  const sourceType = post.source?.type || "";
  if (post.platform) return post.platform;
  if (sourceType.startsWith("instagram") || String(post.permalink || "").includes("instagram.com")) return "instagram";
  if (sourceType.startsWith("threads") || String(post.permalink || "").includes("threads.")) return "threads";
  return "unknown";
}

function countTermMatches(text, terms) {
  return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0);
}

function scoreSentiment(text) {
  const positive = countTermMatches(text, POSITIVE_TERMS);
  const negative = countTermMatches(text, NEGATIVE_TERMS);
  const score = positive - negative;

  let label = "neutral";
  if (score > 0) label = "positive";
  if (score < 0) label = "negative";

  return { label, score, positive, negative };
}

function postDateInRange(post, since, until) {
  const rawDate = post.timestamp || post.collected_at;
  if (!rawDate) return true;
  const date = new Date(rawDate);
  return date >= since && date <= until;
}

function addLocalMatches({ buckets, posts, since, until }) {
  for (const bucket of buckets.values()) {
    for (const post of posts) {
      if (!post.id || !postDateInRange(post, since, until)) continue;
      const searchableText = `${post.text || post.caption || ""} ${post.permalink || ""} ${post.source?.hashtag || ""}`;
      const keyword = bucket.keyword.replace(/^#/, "");
      if (!searchableText.includes(bucket.keyword) && !searchableText.includes(`#${keyword}`) && post.source?.hashtag !== keyword) continue;
      bucket.postsById.set(`${post.platform || detectPlatform(post)}:${post.id}`, post);
    }
  }
}

function countBy(posts, getter) {
  const counts = {};
  for (const post of posts) {
    const key = getter(post) || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarizeBuckets({ buckets, since, until }) {
  return [...buckets.values()].map((bucket) => {
    const posts = [...bucket.postsById.values()]
      .map(normalizePost)
      .sort((a, b) => b.metrics.engagement - a.metrics.engagement || new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    const dates = posts.map((post) => post.timestamp).filter(Boolean).sort();
    const sentimentBreakdown = countBy(posts, (post) => post.sentiment.label);
    const negativePosts = posts.filter((post) => post.sentiment.label === "negative");

    return {
      category: bucket.category,
      keyword: bucket.keyword,
      volume: posts.length,
      engagement: posts.reduce((sum, post) => sum + post.metrics.engagement, 0),
      platform_breakdown: countBy(posts, (post) => post.platform),
      sentiment: {
        positive: sentimentBreakdown.positive || 0,
        neutral: sentimentBreakdown.neutral || 0,
        negative: sentimentBreakdown.negative || 0,
        score: posts.reduce((sum, post) => sum + post.sentiment.score, 0),
      },
      earliest: dates[0] || null,
      latest: dates.at(-1) || null,
      attempts: bucket.attempts,
      top_posts: posts.slice(0, 3),
      negative_posts: negativePosts.slice(0, 3),
      range: {
        since: since.toISOString(),
        until: until.toISOString(),
      },
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = await loadEnv();
  const token = env.THREADS_ACCESS_TOKEN;

  if (args.includeThreadsApi && !token) {
    throw new Error("THREADS_ACCESS_TOKEN is missing in .env");
  }

  const groups = getGroups(args);
  const { since, until } = buildRange(args.days);
  const buckets = new Map();
  const recentJobs = [];

  for (const [category, keywords] of Object.entries(groups)) {
    for (const keyword of keywords) {
      const bucketKey = `${category}\t${keyword}`;
      buckets.set(bucketKey, { category, keyword, attempts: [], postsById: new Map() });
      recentJobs.push({ category, keyword, searchType: "RECENT" });
    }
  }

  const runJob = async (job) => {
    const result = await searchKeyword({
      token,
      keyword: job.keyword,
      searchType: job.searchType,
      timeoutMs: args.timeoutMs,
    });
    const bucket = buckets.get(`${job.category}\t${job.keyword}`);
    bucket.attempts.push({
      search_type: job.searchType,
      status: result.status,
      returned: result.data.length,
      error: result.error,
    });

    for (const item of result.data) {
      if (!item.id || !item.timestamp) continue;
      const timestamp = new Date(item.timestamp);
      if (timestamp < since || timestamp > until) continue;
      bucket.postsById.set(item.id, item);
    }

    return { job, result };
  };

  if (args.includeThreadsApi) {
    await mapLimit(recentJobs, args.concurrency, runJob);
  }

  if (args.includeThreadsApi && args.includeTop) {
    const topJobs = [...buckets.values()]
      .filter((bucket) => bucket.postsById.size > 0)
      .map((bucket) => ({ category: bucket.category, keyword: bucket.keyword, searchType: "TOP" }));
    await mapLimit(topJobs, args.concurrency, runJob);
  }

  if (args.includeLocal) {
    addLocalMatches({
      buckets,
      posts: await readLocalPosts(),
      since,
      until,
    });
  }

  const topics = summarizeBuckets({ buckets, since, until });
  const ranked = topics
    .filter((topic) => topic.volume > 0)
    .sort((a, b) => b.volume - a.volume || b.engagement - a.engagement || String(b.latest).localeCompare(String(a.latest)));

  const report = {
    generated_at: new Date().toISOString(),
    range: {
      days: args.days,
      since: since.toISOString(),
      until: until.toISOString(),
    },
    settings: {
      concurrency: args.concurrency,
      timeout_ms: args.timeoutMs,
      include_top_for_topics_with_results: args.includeTop,
      include_local_posts: args.includeLocal,
      include_threads_api: args.includeThreadsApi,
    },
    checked_keywords: topics.length,
    topics_with_results: ranked.length,
    top_10: ranked.slice(0, 10),
    zero_result_keywords: topics.filter((topic) => topic.volume === 0).map((topic) => `${topic.category}:${topic.keyword}`),
    timed_out: topics.flatMap((topic) =>
      topic.attempts
        .filter((attempt) => attempt.error === "timeout")
        .map((attempt) => `${topic.category}:${topic.keyword}:${attempt.search_type}`),
    ),
  };

  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
