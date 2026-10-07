import assert from "node:assert/strict";
import { test } from "node:test";
import { canAccessPath, createSessionToken, getAdminLoginPath, verifySessionToken } from "./session";

process.env.GATEWAY_SECRET ??= "test-secret-test-secret-test-secret";

const USER_ID = "0b7c6a52-3f7e-4d4a-9d1e-2f0f6c1b9a10";

test("管理员与用户会话往返", async () => {
  const admin = await createSessionToken({ role: "admin" });
  assert.deepEqual(await verifySessionToken(admin.token), { role: "admin" });
  const user = await createSessionToken({ role: "user", userId: USER_ID });
  assert.deepEqual(await verifySessionToken(user.token), { role: "user", userId: USER_ID });
});

test("篡改 subject 或过期的会话无效", async () => {
  const { token } = await createSessionToken({ role: "user", userId: USER_ID });
  const [exp, , sig] = token.split(".");
  assert.equal(await verifySessionToken(`${exp}.admin.${sig}`), null);
  const old = await createSessionToken({ role: "admin" }, Date.now() - 8 * 24 * 3600 * 1000);
  assert.equal(await verifySessionToken(old.token), null);
  // 旧版两段式 Cookie 不再被接受
  assert.equal(await verifySessionToken(`${exp}.${sig}`), null);
});

test("角色只能访问各自的页面", () => {
  const user = { role: "user", userId: USER_ID } as const;
  assert.equal(canAccessPath(user, "/console/logs"), true);
  assert.equal(canAccessPath(user, "/keys"), false);
  assert.equal(canAccessPath(user, "/consoleX"), false);
  assert.equal(canAccessPath({ role: "admin" }, "/providers"), true);
  assert.equal(canAccessPath({ role: "admin" }, "/console"), false);
});

test("管理员登录入口：未配置或过短时关闭", () => {
  assert.equal(getAdminLoginPath(undefined), null);
  assert.equal(getAdminLoginPath("admin"), null);
  assert.equal(getAdminLoginPath("/a/b-c-d-e-f-g-h"), null);
  assert.equal(getAdminLoginPath("ops-7f3k9q2xw8"), "/ops-7f3k9q2xw8");
  assert.equal(getAdminLoginPath("/ops-7f3k9q2xw8"), "/ops-7f3k9q2xw8");
});
