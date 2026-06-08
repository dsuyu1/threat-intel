import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..");
const learnRoot = path.join(webRoot, "src", "content", "learn");
const outDir = path.join(learnRoot, "_generated");
const outMdxDir = path.join(outDir, "mdx");
const outManifest = path.join(outDir, "manifest.ts");
const outSearch = path.join(webRoot, "public", "learn", "search-index.json");

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function walk(dir) {
  /** @type {string[]} */
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith("_generated")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile() && e.name.endsWith(".mdx")) out.push(full);
  }
  return out;
}

function parseFrontmatter(raw, absPath) {
  const m = raw.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (!m) {
    throw new Error(`Missing YAML frontmatter in ${absPath}`);
  }
  const fm = yaml.load(m[1]) ?? {};
  if (typeof fm !== "object" || Array.isArray(fm)) {
    throw new Error(`Invalid YAML frontmatter in ${absPath}`);
  }
  return /** @type {Record<string, any>} */ (fm);
}

function stripFrontmatter(raw) {
  return raw.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n?/, "");
}

function toPosix(p) {
  return p.replaceAll("\\", "/");
}

function computeProviderImportSource(outPath) {
  const providerAbs = path.join(webRoot, "src", "mdx-provider.ts");
  let rel = path.relative(path.dirname(outPath), providerAbs);
  rel = toPosix(rel).replace(/\.ts$/, "");
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

async function compileMdxToTs(source, absPath, outPath) {
  try {
    const compiled = await compile(source, {
      providerImportSource: computeProviderImportSource(outPath),
      remarkPlugins: [remarkGfm],
      rehypePlugins: [rehypeSlug, rehypeAutolinkHeadings],
    });
    return String(compiled);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to compile MDX in ${absPath}: ${msg}`);
  }
}

function stripMdxToText(raw) {
  let s = stripFrontmatter(raw);
  s = s.replace(/^\s*(import|export)\s+.*$/gm, "");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`[^`]*`/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  s = s.replace(/[#>*_~]/g, " ");
  s = s.replace(/-{3,}/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function computeHref(absPath) {
  const rel = path.relative(learnRoot, absPath).replaceAll("\\", "/");
  const noExt = rel.replace(/\.mdx$/, "");
  if (noExt === "index") return "/learn";
  if (noExt.endsWith("/index")) return `/learn/${noExt.slice(0, -"/index".length)}`;
  return `/learn/${noExt}`;
}

function stableNumber(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function validateFrontmatter(fm, absPath) {
  const required = ["title", "section", "lastUpdated"];
  for (const k of required) {
    if (!fm[k] || typeof fm[k] !== "string") {
      throw new Error(`Missing required frontmatter "${k}" in ${absPath}`);
    }
  }
}

function sortDocs(a, b) {
  const ao = stableNumber(a.frontmatter.order, Number.POSITIVE_INFINITY);
  const bo = stableNumber(b.frontmatter.order, Number.POSITIVE_INFINITY);
  if (ao !== bo) return ao - bo;
  return String(a.frontmatter.title).localeCompare(String(b.frontmatter.title));
}

function buildNav(docs) {
  /** @type {Map<string, any[]>} */
  const bySection = new Map();
  for (const d of docs) {
    const section = String(d.frontmatter.section);
    if (!bySection.has(section)) bySection.set(section, []);
    bySection.get(section).push({
      href: d.href,
      title: d.frontmatter.title,
      description: d.frontmatter.description ?? "",
      order: d.frontmatter.order ?? null,
      proOnly: Boolean(d.frontmatter.proOnly),
    });
  }

  const sections = Array.from(bySection.entries()).map(([section, items]) => {
    items.sort((a, b) => {
      const ao = stableNumber(a.order, Number.POSITIVE_INFINITY);
      const bo = stableNumber(b.order, Number.POSITIVE_INFINITY);
      if (ao !== bo) return ao - bo;
      return String(a.title).localeCompare(String(b.title));
    });
    const minOrder = items.length ? stableNumber(items[0].order, Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
    return { section, items, _minOrder: minOrder };
  });

  sections.sort((a, b) => {
    if (a._minOrder !== b._minOrder) return a._minOrder - b._minOrder;
    return a.section.localeCompare(b.section);
  });

  return sections.map(({ section, items }) => ({ section, items }));
}

function tsString(s) {
  return JSON.stringify(String(s));
}

function generateManifest(docs) {
  const imports = [];
  const entries = [];
  const frontmatters = [];

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const id = `Doc${i}`;
    const fmId = `fm${i}`;
    const relImport = `./mdx/${d.relPath.replaceAll("\\", "/").replace(/\.mdx$/, "")}`;
    imports.push(`import ${id} from ${tsString(relImport)};`);
    frontmatters.push(`const ${fmId} = ${JSON.stringify(d.frontmatterNormalized, null, 2)} as LearnFrontmatter;`);
    entries.push(
      `  ${tsString(d.href)}: { href: ${tsString(d.href)}, frontmatter: ${fmId}, Component: ${id} },`,
    );
  }

  const nav = buildNav(docs);
  const flat = nav.flatMap((s) => s.items.map((i) => i.href));

  return `/* eslint-disable */
// This file is auto-generated by scripts/generate-learn.mjs. Do not edit by hand.

import type { ComponentType } from "react";
${imports.join("\n")}
${frontmatters.join("\n")}

export type LearnFrontmatter = {
  title: string;
  section: string;
  description?: string;
  order?: number;
  lastUpdated: string;
  proOnly?: boolean;
};

export type LearnDoc = {
  href: string;
  frontmatter: LearnFrontmatter;
  Component: ComponentType<any>;
};

export const learnNav = ${JSON.stringify(nav, null, 2)} as const;

export const learnDocsByHref: Record<string, LearnDoc> = {
${entries.join("\n")}
};

export const learnFlatOrder = ${JSON.stringify(flat, null, 2)} as const;

export function getLearnDoc(href: string) {
  return learnDocsByHref[href] ?? null;
}

export function getLearnPrevNext(href: string): { prev: LearnDoc | null; next: LearnDoc | null } {
  const i = (learnFlatOrder as readonly string[]).indexOf(href);
  if (i < 0) return { prev: null, next: null };
  const prevHref = i > 0 ? learnFlatOrder[i - 1] : null;
  const nextHref = i < learnFlatOrder.length - 1 ? learnFlatOrder[i + 1] : null;
  return {
    prev: prevHref ? learnDocsByHref[prevHref] ?? null : null,
    next: nextHref ? learnDocsByHref[nextHref] ?? null : null,
  };
}
`;
}

function normalizeFrontmatter(fm) {
  /** @type {any} */
  const out = {
    title: String(fm.title ?? ""),
    section: String(fm.section ?? ""),
    lastUpdated: String(fm.lastUpdated ?? ""),
  };
  if (fm.description) out.description = String(fm.description);
  if (fm.order !== undefined && fm.order !== null && fm.order !== "") {
    const n = Number(fm.order);
    if (Number.isFinite(n)) out.order = n;
  }
  if (fm.proOnly) out.proOnly = true;
  return out;
}

async function main() {
  if (!fs.existsSync(learnRoot)) {
    console.error(`Learn content root not found: ${learnRoot}`);
    process.exit(1);
  }

  const mdxFiles = walk(learnRoot).sort();
  const docs = mdxFiles.map((absPath) => {
    const raw = fs.readFileSync(absPath, "utf8");
    const frontmatter = parseFrontmatter(raw, absPath);
    validateFrontmatter(frontmatter, absPath);
    const relPath = path.relative(learnRoot, absPath);
    return {
      absPath,
      relPath,
      href: computeHref(absPath),
      frontmatter,
      frontmatterNormalized: normalizeFrontmatter(frontmatter),
      raw,
    };
  });

  docs.sort((a, b) => a.href.localeCompare(b.href));

  // Stable ordering for navigation / prev-next is based on frontmatter section + order.
  const docsForNav = [...docs].sort(sortDocs);

  ensureDir(outDir);
  ensureDir(outMdxDir);

  for (const d of docs) {
    const outRel = d.relPath.replace(/\.mdx$/, ".ts");
    const outPath = path.join(outMdxDir, outRel);
    ensureDir(path.dirname(outPath));
    const compiled = await compileMdxToTs(stripFrontmatter(d.raw), d.absPath, outPath);
    const banner = `/* eslint-disable */
// @ts-nocheck
// This file is auto-generated by scripts/generate-learn.mjs. Do not edit by hand.

`;
    fs.writeFileSync(outPath, banner + compiled, "utf8");
  }

  fs.writeFileSync(outManifest, generateManifest(docsForNav), "utf8");

  ensureDir(path.dirname(outSearch));
  const searchIndex = docs.map((d) => ({
    href: d.href,
    title: d.frontmatter.title,
    section: d.frontmatter.section,
    description: d.frontmatter.description ?? "",
    body: stripMdxToText(d.raw),
  }));
  fs.writeFileSync(outSearch, JSON.stringify(searchIndex, null, 2), "utf8");

  console.log(`generate-learn: ${docs.length} doc(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
