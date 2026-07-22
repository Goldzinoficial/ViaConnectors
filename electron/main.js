const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const { spawn } = require("node:child_process");
const http = require("node:http");

// Matches the port *and host* the GitHub OAuth app's callback URL is
// already registered for (see README): http://localhost:3000/api/auth/...
// GitHub matches redirect_uri as an exact string — "localhost" and
// "127.0.0.1" are different hosts to it even though they're the same
// machine, so using the wrong one here gets a flat "Invalid Redirect URI"
// rejection. Everything the app *loads* or advertises to itself uses this
// origin; only the raw server bind below stays on the 127.0.0.1 interface.
const PORT = 3000;
const ORIGIN = `http://localhost:${PORT}`;
const ICON_PATH = path.join(__dirname, "icon.ico");
let serverProcess = null;
let mainWindow = null;

// Launched via double-click, this app has no console anywhere to print
// to — every previous silent failure was invisible for exactly that
// reason. Everything interesting goes to this file instead, next to the
// app's own user-data folder, so it can always be inspected after the fact.
const logPath = path.join(app.getPath("userData"), "launch.log");
function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch {
    // best-effort — a failed log write shouldn't crash the app
  }
}

function serverEntryPath() {
  // Packaged app: the standalone server ships under resources/standalone.
  // Dev run (`npm run electron`): it's wherever `next build` just put it.
  return app.isPackaged
    ? path.join(process.resourcesPath, "standalone", "server.js")
    : path.join(__dirname, "..", ".next", "standalone", "server.js");
}

// Checks the port ourselves before spawning anything — if it's already
// taken (another copy of this app, a leftover `next dev`, anything), the
// window would otherwise silently load whatever *that* is instead of our
// own server, with no error and no clue why. Fail loudly instead.
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

function startServer() {
  const entry = serverEntryPath();
  const entryExists = fs.existsSync(entry);
  log("starting server, entry =", entry, "exists =", entryExists, "execPath =", process.execPath);

  if (!entryExists) {
    dialog.showErrorBox(
      "ViaConnectors is missing a file",
      `The bundled server wasn't found at:\n${entry}\n\nThe app may not have packaged correctly. Log: ${logPath}`
    );
    app.quit();
    return;
  }

  try {
    // A raw fd (not a Stream object) avoids any race with the stream's own
    // "open" event — spawn() needs something it can hand off immediately.
    const fd = fs.openSync(logPath, "a");

    // Electron's own binary can run as a plain Node process (ELECTRON_RUN_AS_NODE) —
    // that's what actually executes the bundled Next.js server, so the packaged
    // app doesn't need a separate Node.js runtime bundled alongside it.
    serverProcess = spawn(process.execPath, [entry], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(PORT),
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        NEXTAUTH_URL: ORIGIN,
      },
      stdio: ["ignore", fd, fd],
      windowsHide: true,
    });
    fs.closeSync(fd); // the child has its own handle to it now

    log("spawn() called, child pid =", String(serverProcess.pid));

    serverProcess.on("error", (err) => {
      log("server process failed to spawn:", err.message);
      dialog.showErrorBox("ViaConnectors couldn't start its server", `${err.message}\n\nLog: ${logPath}`);
      app.quit();
    });

    serverProcess.on("exit", (code) => {
      log("server process exited with code", String(code));
    });
  } catch (err) {
    log("startServer() threw:", err instanceof Error ? err.stack || err.message : String(err));
    dialog.showErrorBox("ViaConnectors couldn't start", `${err}\n\nLog: ${logPath}`);
    app.quit();
  }
}

function waitForServer(url, onReady, deadline = Date.now() + 30_000) {
  const attempt = () => {
    http
      .get(url, (res) => {
        res.destroy();
        onReady();
      })
      .on("error", (err) => {
        if (Date.now() > deadline) {
          log("gave up waiting for server:", err.message);
          dialog.showErrorBox(
            "ViaConnectors couldn't start",
            `The app's own server never came up in time.\n\nLog: ${logPath}`
          );
          app.quit();
          return;
        }
        setTimeout(attempt, 300);
      });
  };
  attempt();
}

function createWindow() {
  log("server is up, opening window");
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 860,
    minHeight: 600,
    title: "ViaConnectors",
    icon: ICON_PATH,
    backgroundColor: "#262624",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription) => {
    if (errorCode === -3) return; // ERR_ABORTED — usually just a redirect mid-flight, not a real failure
    log("page failed to load:", String(errorCode), errorDescription);
    dialog.showErrorBox("ViaConnectors failed to load", `${errorDescription} (${errorCode})`);
  });

  mainWindow.loadURL(ORIGIN);
}

app.whenReady().then(async () => {
  log("app ready, isPackaged =", String(app.isPackaged), "resourcesPath =", process.resourcesPath);

  const free = await isPortFree(PORT);
  log("port", String(PORT), "free =", String(free));
  if (!free) {
    dialog.showErrorBox(
      "Port already in use",
      `Something else on this machine is already using port ${PORT} (maybe another copy of ViaConnectors, or a "next dev" server). Close it and reopen ViaConnectors.\n\nLog: ${logPath}`
    );
    app.quit();
    return;
  }

  startServer();
  waitForServer(ORIGIN, createWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (serverProcess) serverProcess.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});
