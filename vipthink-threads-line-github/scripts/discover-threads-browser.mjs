import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { buildAliasesForBrands, loadBrandAliases } from "./lib/brand-aliases.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const DEFAULT_OUTPUT_PATH = path.join(DATA_DIR, "threads-manual-urls.txt");
const DEFAULT_PROFILE_DIR = path.join(DATA_DIR, "playwright-threads-profile");

function parseArgs(argv) {
  const args = {
    brands: [],
    output: DEFAULT_OUTPUT_PATH,
    profileDir: DEFAULT_PROFILE_DIR,
    headed: true,
    scrolls: 8,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--brand") {
      args.brands.push(argv[index + 1]);
      index += 1;
    } else if (arg === "--output") {
      args.output = argv[index + 1] || DEFAULT_OUTPUT_PATH;
      index += 1;
    } else if (arg === "--profile-dir") {
      args.profileDir = argv[index + 1] || DEFAULT_PROFILE_DIR;
      index += 1;
    } else if (arg === "--headless") {
      args.headed = false;
    } else if (arg === "--scrolls") {
      args.scrolls = Number(argv[index + 1]);
      index += 1;
    }
  }

  args.brands = args.brands.filter(Boolean);
  if (!Number.isFinite(args.scrolls) || args.scrolls <= 0) args.scrolls = 8;
  return args;
}

function normalizeThreadsUrl(input) {
  try {
    const url = new URL(String(input));
    if (!url.hostname.includes("threads.com")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
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

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error('Playwright is not installed. Run: npm install -D playwright');
  }
}

async function waitForUserLogin() {
  const rl = readline.createInterface({ input, output });
  try {
    await rl.question("If Threads asks you to log in, finish login in the browser window, then press Enter here.");
  } finally {
    rl.close();
  }
}

async function ensureSearchContext(page) {
  const searchLinkSelectors = [
    'a[href*="/search"]',
    '[aria-label="Search"]',
    '[aria-label*="Search"]',
  ];

  for (const selector of searchLinkSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(1000);
      return;
    }
  }
}

async function searchBrand(page, brand) {
  const directUrls = [
    `https://www.threads.com/search?q=${encodeURIComponent(brand)}`,
    `https://www.threads.net/search?q=${encodeURIComponent(brand)}`,
  ];

  for (const url of directUrls) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);
    if (String(page.url()).includes("/search")) return;
  }

  await page.goto("https://www.threads.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await ensureSearchContext(page);

  const inputSelectors = [
    'input[placeholder*="Search"]',
    'input[aria-label*="Search"]',
    'textarea[placeholder*="Search"]',
    'input[type="search"]',
  ];

  for (const selector of inputSelectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill("");
      await locator.fill(brand);
      await locator.press("Enter").catch(() => {});
      await page.waitForTimeout(2500);
      return;
    }
  }

  throw new Error(`Could not find Threads search input for brand: ${brand}`);
}

function stripMediaSuffix(url) {
  return String(url || "").replace(/\/media$/, "");
}

function textMatchesAliases(text, aliases) {
  const searchable = String(text || "").toLowerCase();
  return aliases.some((alias) => searchable.includes(String(alias).toLowerCase()));
}

async function collectVisiblePostUrls(page, aliases, scrolls) {
  const urls = new Set();

  for (let index = 0; index < scrolls; index += 1) {
    const candidates = await page.$$eval('a[href*="/post/"]', (anchors) =>
      anchors.map((anchor) => ({
        href: anchor.href,
        text: anchor.closest("article, div")?.innerText || anchor.innerText || "",
      })),
    ).catch(() => []);

    for (const candidate of candidates) {
      if (!textMatchesAliases(candidate.text, aliases)) continue;
      const normalized = candidate.href ? stripMediaSuffix(candidate.href.split("?")[0]) : null;
      if (normalized) urls.add(normalized);
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5)).catch(() => {});
    await page.waitForTimeout(1500);
  }

  return [...urls].map(normalizeThreadsUrl).filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.brands.length === 0) {
    throw new Error("At least one --brand is required");
  }

  const { chromium } = await importPlaywright();
  const browser = await chromium.launchPersistentContext(args.profileDir, {
    headless: !args.headed,
    viewport: { width: 1440, height: 1200 },
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto("https://www.threads.com/", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await waitForUserLogin();

  const discovered = new Set(await readExistingUrls(args.output));
  const results = [];
  const aliasMap = await loadBrandAliases();
  const brandAliases = buildAliasesForBrands(args.brands, aliasMap);

  for (const brand of args.brands) {
    try {
      await searchBrand(page, brand);
      const urls = await collectVisiblePostUrls(page, brandAliases.get(brand) || [brand], args.scrolls);
      for (const url of urls) discovered.add(url);
      results.push({
        brand,
        ok: true,
        aliases: brandAliases.get(brand) || [brand],
        urls_found: urls.length,
        sample_urls: urls.slice(0, 5),
      });
    } catch (error) {
      results.push({ brand, ok: false, urls_found: 0, error: error.message });
    }
  }

  const finalUrls = [...discovered];
  await writeUrls(args.output, finalUrls);
  await browser.close();

  console.log(JSON.stringify({
    ok: true,
    brands: args.brands,
    aliases: Object.fromEntries([...brandAliases.entries()]),
    output: args.output,
    profile_dir: args.profileDir,
    total_urls: finalUrls.length,
    results,
    sample_urls: finalUrls.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
