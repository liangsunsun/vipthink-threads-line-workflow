import fs from "node:fs/promises";
import path from "node:path";
import { buildAliasesForBrands, loadBrandAliases } from "./lib/brand-aliases.mjs";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "threads-posts.json");

function parseArgs(argv) {
  const args = {
    days: 365,
    brands: [],
    officials: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--brand") {
      args.brands.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--official") {
      args.officials.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--days") {
      args.days = Number(argv[index + 1]);
      index += 1;
    }
  }

  args.brands = args.brands.filter(Boolean);
  args.officials = args.officials.filter(Boolean).map((item) => item.toLowerCase());
  if (!Number.isFinite(args.days) || args.days <= 0) args.days = 365;
  return args;
}

function inRange(post, since) {
  const raw = post.timestamp || post.collected_at;
  if (!raw) return true;
  return new Date(raw) >= since;
}

function findMatchedBrand(post, brandTerms) {
  const searchable = `${post.text || ""} ${post.permalink || ""} ${post.source?.url || ""}`.toLowerCase();
  for (const [brand, terms] of brandTerms.entries()) {
    if (terms.some((term) => searchable.includes(term.toLowerCase()))) {
      return brand;
    }
  }
  return null;
}

function summarizeText(text, maxLength) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}...`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.brands.length === 0) {
    throw new Error("At least one --brand is required");
  }

  const db = JSON.parse(await fs.readFile(DATA_PATH, "utf8"));
  const posts = Array.isArray(db.posts) ? db.posts : [];
  const since = new Date();
  since.setDate(since.getDate() - args.days);
  const aliasMap = await loadBrandAliases();
  const brandTerms = buildAliasesForBrands(args.brands, aliasMap);

  const matches = posts
    .filter((post) => post.username)
    .filter((post) => !args.officials.includes(String(post.username).toLowerCase()))
    .filter((post) => inRange(post, since))
    .map((post) => ({
      ...post,
      matched_brand: findMatchedBrand(post, brandTerms),
    }))
    .filter((post) => post.matched_brand);

  const counts = {};
  for (const brand of args.brands) {
    counts[brand] = 0;
  }

  for (const post of matches) {
    counts[post.matched_brand] += 1;
  }

  const samples = matches.slice(0, 10).map((post) => ({
    brand: post.matched_brand,
    username: post.username,
    timestamp: post.timestamp || post.collected_at || null,
    permalink: post.permalink || "",
    text: summarizeText(post.text, 160),
  }));

  console.log(JSON.stringify({
    ok: true,
    source_updated_at: db.updated_at || null,
    days: args.days,
    officials_excluded: args.officials,
    counts,
    total_matches: matches.length,
    samples,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
