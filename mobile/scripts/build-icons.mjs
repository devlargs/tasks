#!/usr/bin/env node
// Builds the app icon from one drawing: the three checkbox states the list
// uses — Todo (empty), In Progress (half-filled), Done (ticked) — growing left
// to right on Catppuccin Mocha. Writes the SVG sources to assets/icon/ and
// renders every PNG app.json points at, plus the iOS Icon Composer bundle.
//
//   node scripts/build-icons.mjs
//
// Rendering goes through headless Chrome (CHROME=/path/to/chrome to override
// the macOS default), so nothing new is installed.

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHROME =
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// --- The drawing ----------------------------------------------------------

// Catppuccin Mocha, as in src/components/theme.ts
const BASE = "#1e1e2e";
const CRUST = "#11111b";
const BLUE = "#89b4fa";
const MUTED = "#7f849c";

// On a 1024 canvas, centred. Everything sits inside the 625px circle that any
// launcher shape leaves visible of an Android adaptive icon (66 of its 108dp).
const CY = 512;
const todo = { x: 208, size: 120, radius: 28, stroke: 18 };
const progress = { x: 358, size: 176, radius: 42, stroke: 24 };
const done = { x: 564, size: 252, radius: 60 };
const top = (box) => CY - box.size / 2;

// A rounded square drawn by its outline, the stroke kept inside the box
const outlined = (box, color) => {
  const inset = box.stroke / 2;
  return `<rect x="${box.x + inset}" y="${top(box) + inset}" width="${box.size - box.stroke}" height="${box.size - box.stroke}" rx="${box.radius - inset}" fill="none" stroke="${color}" stroke-width="${box.stroke}"/>`;
};

// In Progress: the half-way square inside the outline, as on the checkbox
const half = (color) => {
  const s = Math.round(progress.size * 0.36);
  const x = progress.x + (progress.size - s) / 2;
  return `<rect x="${x}" y="${CY - s / 2}" width="${s}" height="${s}" rx="14" fill="${color}"/>`;
};

// Done: the checkbox's own tick (M5 12.5 l4.5 4.5 L19 7.5 in a 24 box),
// scaled into the filled square
const TICK = (() => {
  const k = (done.size * 0.68) / 24;
  const cx = done.x + done.size / 2;
  const pt = (x, y) => `${(cx + (x - 12) * k).toFixed(1)} ${(CY + (y - 12.25) * k).toFixed(1)}`;
  return `M${pt(5, 12.5)} L${pt(9.5, 17)} L${pt(19, 7.5)}`;
})();

const doneBox = (fill) =>
  `<rect x="${done.x}" y="${top(done)}" width="${done.size}" height="${done.size}" rx="${done.radius}" fill="${fill}"/>`;

const svg = (body, defs = "", viewBox = "0 0 1024 1024", size = [1024, 1024]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size[0]}" height="${size[1]}" viewBox="${viewBox}">${
    defs ? `<defs>${defs}</defs>` : ""
  }${body}</svg>\n`;

const background = {
  defs: `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BASE}"/><stop offset="1" stop-color="${CRUST}"/></linearGradient><radialGradient id="glow" cx="${(done.x + done.size / 2) / 1024}" cy="0.5" r="0.42"><stop offset="0" stop-color="${BLUE}" stop-opacity="0.16"/><stop offset="1" stop-color="${BLUE}" stop-opacity="0"/></radialGradient>`,
  body: `<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>`,
};

const mark = `${outlined(todo, MUTED)}${outlined(progress, BLUE)}${half(BLUE)}${doneBox(BLUE)}<path d="${TICK}" fill="none" stroke="${CRUST}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>`;

// One colour, the tick cut out of the done square: Android's themed icon
const monochrome = {
  defs: `<mask id="tick"><rect width="1024" height="1024" fill="#fff"/><path d="${TICK}" fill="none" stroke="#000" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></mask>`,
  body: `${outlined(todo, "#fff")}${outlined(progress, "#fff")}${half("#fff")}<g mask="url(#tick)">${doneBox("#fff")}</g>`,
};

// Where nothing crops into a circle (iOS, the store, the favicon) the mark can
// fill more of the square
const FULL_SCALE = 1.3;
const full = (body) =>
  `<g transform="translate(512 ${CY}) scale(${FULL_SCALE}) translate(-512 -${CY})">${body}</g>`;

// The mark's own bounds, for the splash screen
const MARK_BOX = [todo.x, top(done), done.x + done.size - todo.x, done.size];

const SOURCES = {
  "icon.svg": svg(background.body + full(mark), background.defs),
  "background.svg": svg(background.body, background.defs),
  // Android's adaptive foreground: kept inside the circle it's cropped to
  "mark.svg": svg(mark),
  "mark-full.svg": svg(full(mark)),
  "mark-monochrome.svg": svg(monochrome.body, monochrome.defs),
  "splash.svg": svg(mark, "", MARK_BOX.join(" "), [MARK_BOX[2], MARK_BOX[3]]),
};

// --- Rendering ------------------------------------------------------------

const OUTPUTS = [
  ["icon.svg", "assets/images/icon.png", 1024],
  ["background.svg", "assets/images/android-icon-background.png", 512],
  ["mark.svg", "assets/images/android-icon-foreground.png", 512],
  ["mark-monochrome.svg", "assets/images/android-icon-monochrome.png", 432],
  ["splash.svg", "assets/images/splash-icon.png", MARK_BOX[2]],
  ["icon.svg", "assets/images/favicon.png", 48],
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withChrome(run) {
  const profile = mkdtempSync(join(tmpdir(), "tasks-icons-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(
    CHROME,
    ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) {
      await wait(200);
      targets = await fetch(`http://127.0.0.1:${port}/json`)
        .then((r) => r.json())
        .catch(() => undefined);
    }
    if (!targets) throw new Error(`Chrome didn't start (${CHROME})`);
    const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((resolve) => (ws.onopen = resolve));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const data = JSON.parse(m.data);
      pending.get(data.id)?.(data);
      pending.delete(data.id);
    };
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        pending.set(++id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    await run(send);
    ws.close();
  } finally {
    // Its profile can only go once Chrome has stopped writing to it
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function render(send, source, width) {
  const [, , w, h] = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(source).slice(1).map(Number);
  const height = Math.round((width * h) / w);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  const src = `data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`;
  await send("Page.navigate", {
    url: `data:text/html,${encodeURIComponent(
      `<html><body style="margin:0;background:transparent"><img src="${src}" width="${width}" height="${height}" style="display:block"></body></html>`,
    )}`,
  });
  await wait(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  return Buffer.from(shot.result.data, "base64");
}

mkdirSync(join(ROOT, "assets/icon"), { recursive: true });
for (const [name, source] of Object.entries(SOURCES)) {
  writeFileSync(join(ROOT, "assets/icon", name), source);
}

// iOS: an Icon Composer bundle, so iOS 26 gives the mark its glass. The
// background is the bundle's own fill; the mark is its one layer.
const bundle = join(ROOT, "assets/tasks.icon");
rmSync(bundle, { recursive: true, force: true });
mkdirSync(join(bundle, "Assets"), { recursive: true });
writeFileSync(join(bundle, "Assets/mark.svg"), SOURCES["mark-full.svg"]);
const srgb = (hex) =>
  `extended-srgb:${[1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5)).join(",")},1.00000`;
writeFileSync(
  join(bundle, "icon.json"),
  `${JSON.stringify(
    {
      fill: { "automatic-gradient": srgb(BASE) },
      groups: [
        {
          layers: [{ "image-name": "mark.svg", name: "mark" }],
          shadow: { kind: "neutral", opacity: 0.5 },
          translucency: { enabled: true, value: 0.4 },
        },
      ],
      "supported-platforms": { circles: ["watchOS"], squares: "shared" },
    },
    null,
    2,
  )}\n`,
);

await withChrome(async (send) => {
  for (const [name, out, width] of OUTPUTS) {
    writeFileSync(join(ROOT, out), await render(send, SOURCES[name], width));
    console.log(`${out} (${width}px wide)`);
  }
});
console.log("assets/icon/*.svg, assets/tasks.icon");
