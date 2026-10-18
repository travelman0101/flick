// Renders public/icon.svg to the PNG sizes the manifest and iOS need.
// Usage: node scripts/icons.mjs
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const svg = await readFile(new URL("../public/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"), omitBackground: name !== "apple-touch-icon.png" });
  await page.close();
}
await browser.close();
console.log("icons written");
