import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const BRAND_ALIASES_PATHS = [
  path.join(ROOT, "config", "brand-aliases.json"),
  path.join(ROOT, "data", "brand-aliases.json"),
];

export async function loadBrandAliases() {
  for (const filePath of BRAND_ALIASES_PATHS) {
    try {
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const entries = Object.entries(raw || {}).map(([brand, aliases]) => [
        String(brand).trim(),
        [...new Set([String(brand).trim(), ...((aliases || []).map((item) => String(item).trim()).filter(Boolean))])],
      ]);
      return new Map(entries.filter(([brand]) => brand));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  return new Map();
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
