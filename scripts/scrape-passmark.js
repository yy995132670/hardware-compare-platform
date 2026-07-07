const fs = require("fs");
const path = require("path");
require("events").defaultMaxListeners = 0;
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const RAW_DIR = path.join(DATA_DIR, "raw");
const LIST_PATH = path.join(DATA_DIR, "passmark-list.json");
const CPU_PATH = path.join(DATA_DIR, "cpus.json");
const META_PATH = path.join(DATA_DIR, "meta.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0";
const EDGE_PATH = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 6);
const LIMIT = Number(process.env.SCRAPE_LIMIT || 0);
const FORCE_REFRESH = process.env.SCRAPE_FORCE === "1";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function toNumber(input) {
  if (!input) {
    return null;
  }
  const cleaned = String(input).replace(/[^0-9.-]/g, "");
  if (!cleaned) {
    return null;
  }
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactWhitespace(text) {
  return text.replace(/\r/g, "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
}

function matchLine(text, pattern) {
  const match = text.match(pattern);
  return match ? compactWhitespace(match[1]) : null;
}

function matchBlock(text, startLabel, endLabels) {
  const start = text.indexOf(startLabel);
  if (start === -1) {
    return null;
  }

  const afterStart = text.slice(start + startLabel.length);
  let endIndex = afterStart.length;
  for (const endLabel of endLabels) {
    const idx = afterStart.indexOf(endLabel);
    if (idx !== -1 && idx < endIndex) {
      endIndex = idx;
    }
  }

  return compactWhitespace(afterStart.slice(0, endIndex));
}

function parseRanks(text) {
  const rankBlock = matchBlock(text, "Overall Rank:", ["Last Price Change:", "Average CPU Mark", "+ COMPARE"]);
  if (!rankBlock) {
    return {
      overallRankText: null,
      cpuRank: null,
      singleThreadRank: null,
      classRank: null,
    };
  }

  const cpuRankMatch = rankBlock.match(/(\d+)(?:st|nd|rd|th)\s+fastest in multithreading/i);
  const singleThreadRankMatch = rankBlock.match(/(\d+)(?:st|nd|rd|th)\s+fastest in single threading/i);
  const classRankMatch = rankBlock.match(/(\d+)(?:st|nd|rd|th)\s+fastest in out of \d+\s+(.+)/i);

  return {
    overallRankText: rankBlock,
    cpuRank: cpuRankMatch ? Number(cpuRankMatch[1]) : null,
    singleThreadRank: singleThreadRankMatch ? Number(singleThreadRankMatch[1]) : null,
    classRank: classRankMatch
      ? {
          rank: Number(classRankMatch[1]),
          className: compactWhitespace(classRankMatch[2]),
        }
      : null,
  };
}

function parseRatings(text) {
  const multiMatch = text.match(/Multithread Rating\s+([\d,]+)/i);
  const singleMatch = text.match(/Single Thread Rating\s+([\d,]+)/i);
  return {
    cpuMark: multiMatch ? toNumber(multiMatch[1]) : null,
    singleThreadRating: singleMatch ? toNumber(singleMatch[1]) : null,
  };
}

function parseCores(text) {
  const simpleMatch = text.match(/Cores:\s*(\d+)\s*Threads:\s*(\d+)/i);
  if (simpleMatch) {
    return {
      physicalCores: Number(simpleMatch[1]),
      threads: Number(simpleMatch[2]),
      coresText: `${simpleMatch[1]} (Threads: ${simpleMatch[2]})`,
    };
  }

  const totalMatch = text.match(/Total Cores:\s*(\d+)\s*Cores,\s*(\d+)\s*Threads/i);
  if (totalMatch) {
    return {
      physicalCores: Number(totalMatch[1]),
      threads: Number(totalMatch[2]),
      coresText: `${totalMatch[1]} (Threads: ${totalMatch[2]})`,
    };
  }

  return {
    physicalCores: null,
    threads: null,
    coresText: null,
  };
}

function parseDetailPage(entry, text, detailUrl) {
  const ranks = parseRanks(text);
  const ratings = parseRatings(text);
  const cores = parseCores(text);
  const cacheText =
    matchBlock(text, "Cache per CPU Package:", [
      "Memory Support:",
      "Other names:",
      "CPU First Seen on Charts:",
      "CPUmark/$Price:",
    ]) || null;

  const memorySupport = matchLine(text, /Memory Support:[ \t]*([^\n\r]+)/i);
  const firstSeen = matchLine(text, /CPU First Seen on Charts:[ \t]*([^\n\r]+)/i);
  const cpuValueText = matchLine(text, /CPUmark\/\$Price:[ \t]*([^\n\r]+)/i);
  const samplesMatch = text.match(/Samples:\s*([\d,]+)\*/i);
  const tdpText =
    matchLine(text, /Typical TDP:[ \t]*([^\n\r]+)/i) ||
    matchLine(text, /\bTDP:[ \t]*([^\n\r]+)/i) ||
    null;

  const normalized = {
    id: entry.id,
    name: entry.name,
    slug: entry.slug,
    brand: entry.name.split(" ")[0] || null,
    source: {
      primary: "PassMark",
      listUrl: entry.listUrl,
      detailUrl,
    },
    scrapedAt: new Date().toISOString(),
    other: matchLine(text, /Description:[ \t]*([^\n\r]*)/i),
    socketType: matchLine(text, /Socket:[ \t]*([^\n\r]*)/i),
    cpuClass: matchLine(text, /Class:[ \t]*([^\n\r]*)/i),
    clockspeed: matchLine(text, /Clockspeed:[ \t]*([^\n\r]*)/i),
    turboSpeed: matchLine(text, /Turbo Speed:[ \t]*([^\n\r]*)/i),
    physicalCores: cores.physicalCores,
    threads: cores.threads,
    physicalCoresText: cores.coresText,
    cache: cacheText,
    memorySupport,
    tdp: tdpText,
    firstSeenOnChart: firstSeen,
    cpuRank: ranks.cpuRank,
    singleThreadRank: ranks.singleThreadRank,
    classRank: ranks.classRank,
    overallRankText: ranks.overallRankText,
    cpuMark: ratings.cpuMark,
    singleThreadRating: ratings.singleThreadRating,
    cpuValue: cpuValueText && cpuValueText !== "NA" ? toNumber(cpuValueText) : null,
    sampleCount: samplesMatch ? toNumber(samplesMatch[1]) : null,
    listCpuMark: entry.cpuMark,
    listCpuRank: entry.rank,
    listCpuValue: entry.cpuValue,
    listPriceUsd: entry.priceUsd,
    verification: {
      listVsDetailCpuMarkMatch: entry.cpuMark == null || ratings.cpuMark == null ? null : entry.cpuMark === ratings.cpuMark,
      listVsDetailCpuRankMatch: entry.rank == null || ranks.cpuRank == null ? null : entry.rank === ranks.cpuRank,
      hasAllRequiredFields: Boolean(
        matchLine(text, /Class:[ \t]*([^\n\r]*)/i) &&
          firstSeen &&
          ratings.cpuMark != null &&
          ratings.singleThreadRating != null
      ),
      missingFields: [
        ["socketType", matchLine(text, /Socket:[ \t]*([^\n\r]*)/i)],
        ["cpuClass", matchLine(text, /Class:[ \t]*([^\n\r]*)/i)],
        ["clockspeed", matchLine(text, /Clockspeed:[ \t]*([^\n\r]*)/i)],
        ["turboSpeed", matchLine(text, /Turbo Speed:[ \t]*([^\n\r]*)/i)],
        ["physicalCores", cores.physicalCores],
        ["cache", cacheText],
        ["tdp", tdpText],
        ["firstSeenOnChart", firstSeen],
        ["cpuRank", ranks.cpuRank],
        ["cpuMark", ratings.cpuMark],
        ["singleThreadRating", ratings.singleThreadRating],
      ]
        .filter(([, value]) => value == null || value === "")
        .map(([key]) => key),
    },
    rawText: text,
  };

  return normalized;
}

async function fetchList(page) {
  const url = "https://www.cpubenchmark.net/cpu-list/all";
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#cputable tr td a", { timeout: 60000 });

  const items = await page.$$eval("#cputable tr", (rows) =>
    rows
      .map((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) => cell.innerText.trim());
        const anchor = row.querySelector("a[href*='cpu_lookup.php']");
        if (!anchor || cells.length < 5) {
          return null;
        }

        const href = anchor.getAttribute("href") || "";
        const url = new URL(href, location.origin);
        return {
          name: anchor.textContent.trim(),
          listUrl: url.toString(),
          id: url.searchParams.get("id"),
          slug: anchor.textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""),
          cpuMarkText: cells[1],
          rankText: cells[2],
          cpuValueText: cells[3],
          priceText: cells[4],
        };
      })
      .filter(Boolean)
  );

  return items.map((item) => ({
    ...item,
    cpuMark: toNumber(item.cpuMarkText),
    rank: toNumber(item.rankText),
    cpuValue: item.cpuValueText === "NA" ? null : toNumber(item.cpuValueText),
    priceUsd: item.priceText === "NA" ? null : toNumber(item.priceText),
  }));
}

async function createBrowser() {
  return chromium.launch({
    executablePath: EDGE_PATH,
    headless: true,
  });
}

async function createPage(browser) {
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    javaScriptEnabled: false,
    viewport: { width: 1440, height: 1200 },
    locale: "en-US",
  });
  await context.route("**/*", (route) => {
    const type = route.request().resourceType();
    if (["image", "media", "font", "stylesheet"].includes(type)) {
      route.abort();
      return;
    }
    route.continue();
  });
  return context.newPage();
}

async function scrapeCpu(browser, entry) {
  const page = await createPage(browser);
  try {
    const detailUrl = `https://www.cpubenchmark.net/cpu.php?id=${entry.id}`;
    await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(150);
    const text = compactWhitespace(await page.locator("body").innerText());
    return parseDetailPage(entry, text, detailUrl);
  } finally {
    await page.context().close();
  }
}

async function runPool(items, worker, concurrency) {
  const results = [];
  let index = 0;

  async function next() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

async function main() {
  ensureDir(DATA_DIR);
  ensureDir(RAW_DIR);

  const browser = await createBrowser();

  try {
    const listPage = await createPage(browser);
    const list = await fetchList(await listPage);
    await listPage.context().close();

    writeJson(LIST_PATH, list);
    console.log(`Fetched CPU list: ${list.length} models`);

    const existing = readJson(CPU_PATH, []);
    const existingMap = FORCE_REFRESH ? new Map() : new Map(existing.map((cpu) => [String(cpu.id), cpu]));
    const pending = list.filter((item) => FORCE_REFRESH || !existingMap.has(String(item.id)));
    const targets = LIMIT > 0 ? pending.slice(0, LIMIT) : pending;

    console.log(`Need detail pages: ${targets.length}`);

    const fetched = await runPool(
      targets,
      async (entry, idx) => {
        const detail = await scrapeCpu(browser, entry);
        existingMap.set(String(entry.id), detail);

        if ((idx + 1) % 50 === 0 || idx === targets.length - 1) {
          const snapshot = Array.from(existingMap.values()).sort((a, b) => Number(a.id) - Number(b.id));
          writeJson(CPU_PATH, snapshot);
          console.log(`Saved progress: ${idx + 1}/${targets.length}`);
        }

        return detail;
      },
      CONCURRENCY
    );

    const cpus = Array.from(existingMap.values()).sort((a, b) => Number(a.id) - Number(b.id));
    writeJson(CPU_PATH, cpus);

    const meta = {
      generatedAt: new Date().toISOString(),
      source: "PassMark CPU Benchmarks",
      sourceListUrl: "https://www.cpubenchmark.net/cpu-list/all",
      totalCpuModelsFromList: list.length,
      detailRecordsStored: cpus.length,
      newlyFetchedThisRun: fetched.length,
      concurrency: CONCURRENCY,
      listConsistency: {
        cpuMarkMatches: cpus.filter((cpu) => cpu.verification.listVsDetailCpuMarkMatch === true).length,
        cpuRankMatches: cpus.filter((cpu) => cpu.verification.listVsDetailCpuRankMatch === true).length,
        missingRequiredFields: cpus.filter((cpu) => !cpu.verification.hasAllRequiredFields).length,
      },
    };

    writeJson(META_PATH, meta);
    console.log(JSON.stringify(meta, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
