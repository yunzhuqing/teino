import test from "node:test";
import assert from "node:assert/strict";
import {
  amountToCredits,
  charge,
  convertCurrency,
  formatAmount,
  formatCredit,
  parseAmount,
  parseCredit,
  parseMultiplier,
  applyMultiplier,
} from "./money";

test("parseAmount 解析 numeric 字符串到 1e-8 标度", () => {
  assert.equal(parseAmount("2"), 200_000_000n);
  assert.equal(parseAmount("2.5"), 250_000_000n);
  assert.equal(parseAmount("0.1"), 10_000_000n);
  assert.equal(parseAmount("0"), 0n);
  assert.equal(parseAmount(""), 0n);
  assert.equal(parseAmount(null), 0n);
  assert.equal(parseAmount("-1.25"), -125_000_000n);
});

test("parseAmount 截断超出列定义的小数位而不进位", () => {
  // 1e-8 标度只保留 8 位小数
  assert.equal(parseAmount("0.000000015"), 1n);
  assert.equal(parseAmount("0.000000019"), 1n);
});

test("parseAmount 拒绝非数字", () => {
  assert.throws(() => parseAmount("abc"));
  assert.throws(() => parseAmount("."));
  assert.throws(() => parseAmount("1.2.3"));
});

test("parseCredit 使用 1e-6 标度", () => {
  assert.equal(parseCredit("1"), 1_000_000n);
  assert.equal(parseCredit("0.5"), 500_000n);
  assert.equal(parseCredit("100.25"), 100_250_000n);
});

test("parseMultiplier 使用 1e-4 标度", () => {
  assert.equal(parseMultiplier(1), 10_000n);
  assert.equal(parseMultiplier(1.5), 15_000n);
  assert.equal(parseMultiplier("2"), 20_000n);
  assert.equal(parseMultiplier("0.5"), 5_000n);
});

test("formatAmount / formatCredit 往返不丢精度", () => {
  for (const s of ["0.00000001", "2.00000000", "0.10000000", "123456.78901234", "-1.50000000"]) {
    assert.equal(formatAmount(parseAmount(s)), s);
  }
  assert.equal(formatCredit(parseCredit("0.000001")), "0.000001");
  assert.equal(formatCredit(parseCredit("12345.678901")), "12345.678901");
});

test("charge 按每百万 token 单价计费", () => {
  // 1M token × $2/M = $2
  assert.equal(charge(1_000_000, parseAmount("2")), parseAmount("2"));
  // 272k token × $2/M = $0.544
  assert.equal(charge(272_000, parseAmount("2")), parseAmount("0.544"));
  // 1000 token × $10/M = $0.01
  assert.equal(charge(1_000, parseAmount("10")), parseAmount("0.01"));
});

test("charge 对非正数与非法输入返回 0", () => {
  assert.equal(charge(0, parseAmount("2")), 0n);
  assert.equal(charge(-5, parseAmount("2")), 0n);
  assert.equal(charge(Number.NaN, parseAmount("2")), 0n);
});

test("charge 把 token 数取整后计费", () => {
  // token 数在真实场景都是整数；小数按四舍五入处理
  assert.equal(charge(0.5, parseAmount("1")), 100n);
  assert.equal(charge(0.4, parseAmount("1")), 0n);
});

test("charge 做 half-up 四舍五入而非截断", () => {
  // 1 token × $0.005/M = 0.5e-8，正好半个最小单位，half-up 应进为 1（截断会得 0）
  assert.equal(charge(1, parseAmount("0.005")), 1n);
  // 1 token × $0.004/M = 0.4e-8，不足半个单位，舍去
  assert.equal(charge(1, parseAmount("0.004")), 0n);
});

test("applyMultiplier 在合计后一次应用倍率", () => {
  assert.equal(applyMultiplier(parseAmount("1"), parseMultiplier(2)), parseAmount("2"));
  assert.equal(applyMultiplier(parseAmount("1"), parseMultiplier("0.5")), parseAmount("0.5"));
  assert.equal(applyMultiplier(parseAmount("0.33333333"), parseMultiplier(3)), parseAmount("0.99999999"));
});

test("amountToCredits 按 1 单位主货币 = n 积分折算", () => {
  // $1 = 100 积分
  assert.equal(amountToCredits(parseAmount("1"), parseAmount("100")), parseCredit("100"));
  // $0.544 = 54.4 积分
  assert.equal(amountToCredits(parseAmount("0.544"), parseAmount("100")), parseCredit("54.4"));
  // 1 积分/USD 时金额与积分数值相同
  assert.equal(amountToCredits(parseAmount("2.5"), parseAmount("1")), parseCredit("2.5"));
});

test("convertCurrency 按汇率折算到主货币", () => {
  // 1 CNY = 0.14 USD
  assert.equal(convertCurrency(parseAmount("100"), parseAmount("0.14")), parseAmount("14"));
  assert.equal(convertCurrency(parseAmount("1"), parseAmount("1")), parseAmount("1"));
});
