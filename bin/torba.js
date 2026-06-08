#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

const { startTorba } = require("../server.js");

const port = Number(process.env.TORBA_PORT || process.env.PORT || 8787);
const host = process.env.TORBA_HOST || process.env.HOST || "127.0.0.1";

function openBrowser(url) {
  if (process.env.TORBA_NO_BROWSER === "1") return;
  const platform = process.platform;
  if (platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

startTorba({ port, host })
  .then(({ url }) => {
    console.log(`Otwieram przeglądarkę: ${url}`);
    openBrowser(url);
  })
  .catch((error) => {
    if (error?.code === "EADDRINUSE") {
      console.error(`Port ${port} jest zajęty. Zamknij poprzednią instancję Torby lub ustaw TORBA_PORT.`);
    } else {
      console.error(error.message || error);
    }
    process.exit(1);
  });
