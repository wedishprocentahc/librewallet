import assert from "node:assert/strict";
import { test } from "node:test";
import { appleScriptString, notifyCommand } from "../server/notify.ts";

test("notification commands per platform; hostile text never reaches a shell", () => {
  const evil = 'x" & do shell script "rm -rf ~" & "';
  assert.equal(appleScriptString(evil), '"x\\" & do shell script \\"rm -rf ~\\" & \\""');
  const mac = notifyCommand("darwin", "T", evil)!;
  assert.equal(mac.cmd, "osascript");
  assert.ok(mac.args[1]!.includes(appleScriptString(evil)));
  const lin = notifyCommand("linux", "T", "B")!;
  assert.deepEqual([lin.cmd, lin.args.at(-2), lin.args.at(-1)], ["notify-send", "T", "B"]);
  const win = notifyCommand("win32", "T", evil)!;
  assert.equal(win.env?.LW_BODY, evil);
  assert.ok(!win.args.join(" ").includes("rm -rf"));
  assert.equal(notifyCommand("freebsd", "T", "B"), null);
});
