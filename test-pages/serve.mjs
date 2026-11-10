// Static server for the frame-scoping test pages: `node test-pages/serve.mjs [port]`
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.argv[2] ?? 5180);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };

createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^[/\\]+/, "");
  const file = path || "index.html";
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { "content-type": types[extname(file)] ?? "text/plain" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
