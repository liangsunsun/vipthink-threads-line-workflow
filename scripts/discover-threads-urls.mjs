import fs from "node:fs/promises";
import path from "node:path";
import { buildAliasesForBrands, loadBrandAliases } from "./lib/brand-aliases.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_OUTPUT_PATH = path.join(DATA_DIR, "threads-manual-urls.txt");

function parseArgs(argv) {
  const args = {
    brands: [],
    output: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--brand") {
      args.brands.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--output") {
      args.output = argv[index + 1] || DEFAULT_OUTPUT_PATH;
      index += 1;
    }
  }

  args.brands = args.brands.filter(Boolean);
  return args;
}

function buildQueries(brandAliases) {
  const queries = new Set();

  for (const aliases of brandAliases.values()) {
    for (const alias of aliases) {
      const value = String(alias || "").trim();
      if (!value) continue;
      queries.add(`site:threads.com "${value}"`);
      queries.add(`site:threads.com ${value}`);
      queries.add(`site:threads.com "${value}" threads`);

      if (value.includes("豌豆思維")) {
        queries.add(`site:threads.com "${value}" 課程`);
        queries.add(`site:threads.com "${value}" 廣告`);
      }
    }
  }

  return [...queries];
}

function normalizeThreadsUrl(input) {
  try {
    const url = new URL(input);
    if (!url.hostname.includes("threads.com")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function extractThreadsUrls(html) {
  const urls = new Set();
  const patterns = [
    /uddg=([^"'&\s>]+)/g,
    /u=([^"'&\s>]+)/g,
    /https?:\/\/www\.threads\.com\/@[^"'<>\s)]+/g,
    /https?:\/\/threads\.com\/@[^"'<>\s)]+/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const candidate = pattern.source.startsWith("uddg=")
        ? decodeURIComponent(match[1])
        : pattern.source.startsWith("u=")
          ? decodeURIComponent(match[1])
          : match[0];
      const normalized = normalizeThreadsUrl(candidate);
      if (normalized) urls.add(normalized);
    }
  }

  return [...urls];
}

async function searchDuckDuckGo(query) {
  const url = new URL("https://duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Threads brand discovery",
    },
  });

  if (!response.ok) {
    throw new Error(`duckduckgo search failed (${response.status})`);
  }

  return response.text();
}

async function searchBing(query) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 Threads brand discovery",
    },
  });

  if (!response.ok) {
    throw new Error(`bing search failed (${response.status})`);
  }

  return response.text();
}

async function runSearches(query) {
  const engines = [
    { name: "duckduckgo", fn: searchDuckDuckGo },
    { name: "bing", fn: searchBing },
  ];
  const results = [];

  for (const engine of engines) {
    try {
      const html = await engine.fn(query);
      results.push({
        engine: engine.name,
        ok: true,
        urls: extractThreadsUrls(html),
      });
    } catch (error) {
      results.push({
        engine: engine.name,
        ok: false,
        urls: [],
        error: error.message,
      });
    }
  }

  return results;
}

async function readExistingUrls(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeUrls(filePath, urls) {
  const content = [
    "# Manually curated or auto-discovered Threads post URLs",
    ...urls,
    "",
  ].join("\n");

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.brands.length === 0) {
    throw new Error("At least one --brand is required");
  }

  const aliasMap = await loadBrandAliases();
  const brandAliases = buildAliasesForBrands(args.brands, aliasMap);
  const queries = buildQueries(brandAliases);
  const discovered = new Set(await readExistingUrls(args.output));
  const queryResults = [];

  for (const query of queries) {
    const engineResults = await runSearches(query);
    const urls = new Set();
    for (const result of engineResults) {
      for (const url of result.urls) {
        urls.add(url);
        discovered.add(url);
      }
    }
    queryResults.push({
      query,
      urls_found: urls.size,
      ok: engineResults.some((result) => result.ok),
      engines: engineResults.map((result) => ({
        engine: result.engine,
        ok: result.ok,
        urls_found: result.urls.length,
        error: result.error || null,
      })),
    });
  }

  const finalUrls = [...discovered];
  await writeUrls(args.output, finalUrls);

  console.log(JSON.stringify({
    ok: true,
    brands: args.brands,
    aliases: Object.fromEntries([...brandAliases.entries()]),
    queries,
    output: args.output,
    total_urls: finalUrls.length,
    query_results: queryResults,
    sample_urls: finalUrls.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
