import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const { stdout } = await execFileAsync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root, maxBuffer: 16 * 1024 * 1024, windowsHide: true
});
const files = [...new Set(stdout.split("\0").filter((filename) => /\.(?:mjs|cjs|js)$/u.test(filename)))];
for (const filename of files) {
  try {
    await execFileAsync(process.execPath, ["--check", path.join(root, filename)], { windowsHide: true });
  } catch (error) {
    console.error(error.stderr || error.message);
    process.exit(1);
  }
}
console.log(`JavaScript syntax checked in ${files.length} files.`);
