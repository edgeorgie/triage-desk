import { execSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyCsp } from "./csp.mjs";

// Builds a static export and publishes it to the gh-pages branch of the origin remote.
const { name } = JSON.parse(readFileSync("package.json", "utf8"));
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

run("npm run build", { env: { ...process.env, DEPLOY_TARGET: "pages", PAGES_BASE_PATH: `/${name}` } });

applyCsp("out", ["https://api.anthropic.com", "https://api.openai.com", "https://api.github.com", "https://raw.githubusercontent.com"]);

const remote = execSync("git remote get-url origin").toString().trim();
const dir = mkdtempSync(join(tmpdir(), "pages-"));
cpSync("out", dir, { recursive: true });
writeFileSync(join(dir, ".nojekyll"), "");
const git = (cmd) => run(`git ${cmd}`, { cwd: dir });
git("init -q -b gh-pages");
git("add -A");
git('commit -q -m "Deploy static export"');
git(`push -q -f ${remote} gh-pages`);
console.log(`Published ${name} to gh-pages. Pages URL: https://edgeorgie.github.io/${name}/`);
