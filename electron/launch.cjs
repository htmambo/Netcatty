const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const electronPath = require("electron"); // returns binary path

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const distIndexPath = path.join(__dirname, "../dist/index.html");
const hasDevServer = Boolean(env.VITE_DEV_SERVER_URL);

if (!hasDevServer && !fs.existsSync(distIndexPath)) {
  console.error(
    [
      "[start] Missing production renderer files: dist/index.html",
      "[start] Run `npm run build` before `npm run start`, or use `npm run dev` for the Vite dev server.",
    ].join("\n"),
  );
  process.exit(1);
}

const child = spawn(electronPath, ["."], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));

// Forward SIGINT/SIGTERM to the Electron child process so Ctrl+C works
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
}
