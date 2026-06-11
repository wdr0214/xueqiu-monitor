import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../src/config.js";

function baseConfig(overrides = {}) {
  return {
    cubeSymbol: "ZH188094",
    holidayFile: "config/market-holidays.cn-a.json",
    wechat: {
      appId: "app",
      appSecret: "secret",
      toOpenId: "openid",
      templateId: "template",
      dryRun: false
    },
    wxpusher: { appToken: "", uid: "", dryRun: false },
    ...overrides
  };
}

test("validates required notifier settings for production", () => {
  const config = baseConfig({
    wechat: {
      appId: "",
      appSecret: "",
      toOpenId: "",
      templateId: "",
      dryRun: false
    },
    wxpusher: { appToken: "", uid: "", dryRun: false }
  });

  assert.throws(() => validateConfig(config), /Missing WeChat configuration/);
});

test("allows missing WeChat settings only in dry-run mode", () => {
  const config = baseConfig({
    wechat: {
      appId: "",
      appSecret: "",
      toOpenId: "",
      templateId: "",
      dryRun: true
    },
    wxpusher: { appToken: "", uid: "", dryRun: true }
  });

  assert.doesNotThrow(() => validateConfig(config));
});

test("allows WxPusher settings instead of WeChat template settings", () => {
  const config = baseConfig({
    wechat: {
      appId: "",
      appSecret: "",
      toOpenId: "",
      templateId: "",
      dryRun: false
    },
    wxpusher: { appToken: "AT_xxx", uid: "UID_xxx", dryRun: false }
  });

  assert.doesNotThrow(() => validateConfig(config));
});
