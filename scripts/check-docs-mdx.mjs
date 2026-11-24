// Compile every content/docs/*.mdx with the same remark plugins the docs
// route uses. Exits 1 on the first compile error per file (all are reported).
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { compile } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const dir = path.join(process.cwd(), "content/docs");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mdx")).sort();
let failed = 0;
for (const f of files) {
  const { content } = matter(fs.readFileSync(path.join(dir, f), "utf8"));
  try {
    await compile(content, { remarkPlugins: [remarkMath, remarkGfm] });
  } catch (e) {
    failed++;
    console.error(`FAIL content/docs/${f}: ${e.message}`);
  }
}
console.log(`${files.length - failed}/${files.length} docs MDX files compile`);
process.exit(failed ? 1 : 0);
