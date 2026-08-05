import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const nativeDirectory = path.resolve(scriptDirectory, "..");
const repositoryDirectory = path.resolve(nativeDirectory, "..");
const webDirectory = path.join(nativeDirectory, "www");

const files = ["index.html", "user.html", "style.css", "script.js"];
const directories = ["assets", "guides", "js", "pages", "vendor"];

await rm(webDirectory, { recursive: true, force: true });
await mkdir(webDirectory, { recursive: true });

for (const file of files) {
  await cp(path.join(repositoryDirectory, file), path.join(webDirectory, file));
}

for (const directory of directories) {
  await cp(path.join(repositoryDirectory, directory), path.join(webDirectory, directory), {
    recursive: true
  });
}

const indexPath = path.join(webDirectory, "index.html");
let indexHtml = await readFile(indexPath, "utf8");

indexHtml = indexHtml.replace(
  /^\s*<script src="js\/data-relay-client\.js[^"]*"><\/script>\s*$/m,
  ""
);
indexHtml = indexHtml.replace(
  /\s*<!-- Cloudflare Web Analytics:[\s\S]*?<!-- End Cloudflare Web Analytics -->/,
  ""
);

const dataSourceScript = /(<script src="js\/data-source\.js[^"]*"><\/script>)/;
if (!dataSourceScript.test(indexHtml)) {
  throw new Error("Could not find the data-source script in index.html.");
}

indexHtml = indexHtml.replace(
  dataSourceScript,
  '<script src="js/native-app.js?v=20260805-ios-spike-1"></script>\n$1'
);

if (indexHtml.includes("data-relay-client.js") || indexHtml.includes("analytics-loader.js")) {
  throw new Error("The native bundle still contains a relay or analytics script tag.");
}

await writeFile(indexPath, indexHtml, "utf8");

console.log(`Prepared native web assets in ${webDirectory}`);
