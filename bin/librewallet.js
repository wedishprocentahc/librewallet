#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");

const { startLibreWallet } = require("../server.js");

const port = Number(process.env.LIBREWALLET_PORT || process.env.PORT || 8787);
const host = process.env.LIBREWALLET_HOST || process.env.HOST || "127.0.0.1";

function openBrowser(url) {
  if (process.env.LIBREWALLET_NO_BROWSER === "1") return;
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

startLibreWallet({ port, host })
  .then(({ url }) => {
    if (process.env.LIBREWALLET_NO_BROWSER === "1") {
      console.log(`LibreWallet serwer: ${url}`);
      return;
    }
    console.log(`Otwieram przeglądarkę: ${url}`);
    openBrowser(url);
  })
  .catch((error) => {
    if (error?.code === "EADDRINUSE") {
      const openHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      const url = `http://${openHost}:${port}/`;
      console.log(`LibreWallet już działa — otwieram ${url}`);
      openBrowser(url);
      return;
    }
    console.error(error.message || error);
    process.exit(1);
  });
