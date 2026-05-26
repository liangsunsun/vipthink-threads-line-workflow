import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BRAND_ALIASES_PATH = path.join(ROOT, "data", "brand-aliases.json");

export async function loadBrandAliases() {
  try {
    const raw = JSON.parse(await fs.readFile(BRAND_ALIASES_PATH, "utf8"));
    const entries = Object.entries(raw || {}).map(([brand, aliases]) => [
      String(brand).trim(),
      [...new Set([String(brand).trim(), ...((aliases || []).map((item) => String(item).trim()).filter(Boolean))])],
    ]);
    return new Map(entries.filter(([brand]) => brand));
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
}

export function buildAliasesForBrands(brands, aliasMap) {
  const result = new Map();

  for (const brand of brands) {
    const normalized = String(brand || "").trim();
    if (!normalized) continue;

    const aliases = aliasMap.get(normalized) || [normalized];
    result.set(normalized, [...new Set(aliases)]);
  }

  return result;
}
