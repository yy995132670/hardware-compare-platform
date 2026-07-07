const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(DATA_DIR, "source-cache", "gpu-passmark");
const GPU_PATH = path.join(DATA_DIR, "gpus.json");
const META_PATH = path.join(DATA_DIR, "gpu-meta.json");
const VERIFY_PATH = path.join(DATA_DIR, "gpu-verification-report.json");
const CONCURRENCY = Number(process.env.GPU_SCRAPE_CONCURRENCY || 8);
const LIMIT = Number(process.env.GPU_SCRAPE_LIMIT || 0);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Referer: "https://www.videocardbenchmark.net/",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode || 0, body: data, headers: res.headers });
          });
        }
      )
      .on("error", reject);
  });
}

async function fetchCached(url, filename) {
  if (fs.existsSync(filename)) {
    return { status: 200, body: fs.readFileSync(filename, "utf8"), cached: true };
  }

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await requestText(url);
      if (result.status === 200 && result.body) {
        fs.writeFileSync(filename, result.body, "utf8");
      }
      return { ...result, cached: false };
    } catch (error) {
      lastError = error;
      await sleep(300 * (attempt + 1));
    }
  }

  return { status: 0, body: "", cached: false, error: lastError?.message || "request failed" };
}

function normalizeText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function parseNumber(text) {
  if (text == null) {
    return null;
  }
  const cleaned = String(text).replace(/,/g, "").replace(/[^0-9.-]/g, "");
  if (!cleaned) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function parseMoney(text) {
  const value = parseNumber(text);
  return value == null ? null : value;
}

function extractBlock(text, label) {
  const match = text.match(new RegExp(`${label}:?\\s*\\n?\\s*([^\\n]+)`));
  return match ? match[1].trim() : null;
}

function detectGpuCategory(gpu) {
  const name = String(gpu.name || "").toLowerCase();
  const category = String(gpu.videocardCategory || "").toLowerCase();

  if (name.includes("server edition")) {
    return "server";
  }
  if (name.includes("workstation edition")) {
    return "workstation";
  }

  if (
    category.includes("server") ||
    category.includes("data center") ||
    category.includes("datacenter") ||
    /(tesla|grid|instinct|h100|h200|a100|a30|l4|l40|mi\d{3,4}|gaudi)/.test(name)
  ) {
    return "server";
  }

  if (category.includes("workstation") || category.includes("professional") || /(quadro|rtx a\d|radeon pro|firepro|pro w)/.test(name)) {
    return "workstation";
  }

  if (category.includes("mobile") || category.includes("laptop") || /(laptop gpu|mobile|mx\d|m\d{3,4}|max-q)/.test(name)) {
    return "laptop";
  }

  if (category.includes("integrated") || category.includes("igp") || /(uhd graphics|iris|vega \d|radeon \d{3}m|arc graphics)/.test(name)) {
    return "integrated";
  }

  if (category.includes("desktop") || /(geforce|radeon rx|radeon hd|arc a\d|arc b\d)/.test(name)) {
    return "desktop";
  }

  return "other";
}

function categoryLabel(category) {
  if (category === "server") return "服务器";
  if (category === "workstation") return "工作站";
  if (category === "desktop") return "桌面";
  if (category === "laptop") return "笔记本";
  if (category === "integrated") return "集成显卡";
  return "其他";
}

function detectBrand(name) {
  const value = String(name || "").toLowerCase();
  if (/(nvidia|geforce|quadro|tesla|grid|rtx|gtx)/.test(value)) return "NVIDIA";
  if (/(amd|ati|radeon|firepro|instinct)/.test(value)) return "AMD";
  if (/(intel|arc|iris|uhd graphics)/.test(value)) return "Intel";
  if (value.includes("matrox")) return "Matrox";
  if (value.includes("s3")) return "S3";
  if (value.includes("powervr")) return "PowerVR";
  return String(name || "").split(" ")[0];
}

async function scrapeList() {
  const listPath = path.join(CACHE_DIR, "gpu_list.html");
  const result = await fetchCached("https://www.videocardbenchmark.net/gpu_list.php", listPath);
  if (result.status !== 200) {
    throw new Error(`Unable to fetch GPU list: ${result.status}`);
  }

  const items = [];
  const rowPattern =
    /<TR id="gpu(\d+)"><TD><A HREF="video_lookup\.php\?gpu=([^"&]+)&amp;id=\d+">([^<]+)<\/A><\/TD><TD>([^<]+)<\/TD><TD>([^<]+)<\/TD><TD>([\s\S]*?)<\/TD><TD>([\s\S]*?)<\/TD><\/TR>/gi;

  for (const match of result.body.matchAll(rowPattern)) {
    const id = match[1];
    const gpuParam = match[2];
    const name = match[3].trim();
    const g3dMark = parseNumber(match[4]);
    const overallRank = parseNumber(match[5]);
    const valueText = match[6].replace(/<[^>]+>/g, "").trim();
    const priceText = match[7].replace(/<[^>]+>/g, "").trim();

    items.push({
      id: String(id),
      name,
      brand: detectBrand(name),
      source: {
        primary: "PassMark",
        listUrl: `https://www.videocardbenchmark.net/video_lookup.php?gpu=${gpuParam}&id=${id}`,
        detailUrl: `https://www.videocardbenchmark.net/gpu.php?gpu=${gpuParam}&id=${id}`,
      },
      listG3dMark: g3dMark,
      listOverallRank: overallRank,
      listValue: valueText === "NA" ? null : parseNumber(valueText),
      listPriceUsd: priceText === "NA" ? null : parseMoney(priceText),
    });
  }

  return items;
}

function parseDetailPage(gpu, html) {
  const text = normalizeText(html);
  const lastPriceChangeText = extractBlock(text, "Last Price Change");
  const lastPriceChangeMatch = lastPriceChangeText
    ? lastPriceChangeText.match(/\$?([\d,]+(?:\.\d+)?)\s*USD\s*\(([^)]+)\)/i)
    : null;

  const g3dMark = text.match(/Average G3D Mark\s*\n\s*([0-9,]+)/i)?.[1];
  const g2dMark = text.match(/Average G2D Mark:\s*\n?\s*([0-9,]+)/i)?.[1];
  const samples = text.match(/Samples:\s*\n?\s*([0-9,]+)/i)?.[1];
  const dx9 = text.match(/DirectX 9\s*\n\s*([0-9.]+)\s*Frames\/Sec/i)?.[1];
  const dx10 = text.match(/DirectX 10\s*\n\s*([0-9.]+)\s*Frames\/Sec/i)?.[1];
  const dx11 = text.match(/DirectX 11\s*\n\s*([0-9.]+)\s*Frames\/Sec/i)?.[1];
  const dx12 = text.match(/DirectX 12\s*\n\s*([0-9.]+)\s*Frames\/Sec/i)?.[1];
  const gpuCompute = text.match(/GPU Compute\s*\n\s*([0-9.]+)\s*Ops\/Sec/i)?.[1];

  Object.assign(gpu, {
    scrapedAt: new Date().toISOString(),
    busInterface: extractBlock(text, "Bus Interface"),
    maxMemorySize: extractBlock(text, "Max Memory Size"),
    coreClock: extractBlock(text, "Core Clock\\(s\\)"),
    memoryClock: extractBlock(text, "Memory Clock\\(s\\)"),
    directx: extractBlock(text, "DirectX"),
    openGL: extractBlock(text, "OpenGL"),
    maxTdp: extractBlock(text, "Max TDP"),
    videocardCategory: extractBlock(text, "Videocard Category"),
    otherNames: extractBlock(text, "Other names"),
    firstBenchmarked: extractBlock(text, "Videocard First Benchmarked"),
    g3dMarkPrice: parseNumber(extractBlock(text, "G3DMark/Price")),
    overallRank: parseNumber(extractBlock(text, "Overall Rank")),
    lastPriceChangeUsd: lastPriceChangeMatch ? parseMoney(lastPriceChangeMatch[1]) : null,
    lastPriceChangeDate: lastPriceChangeMatch ? lastPriceChangeMatch[2] : null,
    g3dMark: parseNumber(g3dMark),
    g2dMark: parseNumber(g2dMark),
    samples: parseNumber(samples),
    directx9Frames: parseNumber(dx9),
    directx10Frames: parseNumber(dx10),
    directx11Frames: parseNumber(dx11),
    directx12Frames: parseNumber(dx12),
    gpuComputeOps: parseNumber(gpuCompute),
    rawText: text,
  });

  gpu.category = detectGpuCategory(gpu);
  gpu.categoryLabel = categoryLabel(gpu.category);

  gpu.verification = {
    listVsDetailG3dMatch: gpu.listG3dMark === gpu.g3dMark,
    listVsDetailRankMatch: gpu.listOverallRank === gpu.overallRank,
    missingFields: [
      ["busInterface", gpu.busInterface],
      ["maxMemorySize", gpu.maxMemorySize],
      ["coreClock", gpu.coreClock],
      ["memoryClock", gpu.memoryClock],
      ["directx", gpu.directx],
      ["openGL", gpu.openGL],
      ["maxTdp", gpu.maxTdp],
      ["videocardCategory", gpu.videocardCategory],
      ["firstBenchmarked", gpu.firstBenchmarked],
      ["g3dMark", gpu.g3dMark],
      ["g2dMark", gpu.g2dMark],
      ["overallRank", gpu.overallRank],
    ]
      .filter(([, value]) => value == null || value === "")
      .map(([key]) => key),
  };
}

async function runPool(items, worker, concurrency) {
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
}

async function scrapeDetails(items) {
  const selectedItems = LIMIT > 0 ? items.slice(0, LIMIT) : items;
  await runPool(
    selectedItems,
    async (gpu) => {
      const detailCache = path.join(CACHE_DIR, `${gpu.id}.html`);
      const result = await fetchCached(gpu.source.detailUrl, detailCache);
      if (result.status === 200 && result.body) {
        parseDetailPage(gpu, result.body);
      }
    },
    CONCURRENCY
  );
}

function buildVerificationReport(items) {
  const missingDetails = items.filter((gpu) => !gpu.g3dMark && !gpu.rawText).map((gpu) => ({ id: gpu.id, name: gpu.name }));
  const incomplete = items
    .filter((gpu) => gpu.verification?.missingFields?.length)
    .map((gpu) => ({ id: gpu.id, name: gpu.name, missingFields: gpu.verification.missingFields }));
  const mismatched = items
    .filter((gpu) => gpu.verification && (!gpu.verification.listVsDetailG3dMatch || !gpu.verification.listVsDetailRankMatch))
    .map((gpu) => ({
      id: gpu.id,
      name: gpu.name,
      listG3dMark: gpu.listG3dMark,
      detailG3dMark: gpu.g3dMark,
      listOverallRank: gpu.listOverallRank,
      detailOverallRank: gpu.overallRank,
    }));

  return {
    generatedAt: new Date().toISOString(),
    listCount: items.length,
    detailCount: items.filter((gpu) => gpu.g3dMark != null).length,
    coverageComplete: missingDetails.length === 0,
    missingDetails,
    incomplete,
    mismatched,
  };
}

async function main() {
  ensureDir(DATA_DIR);
  ensureDir(CACHE_DIR);

  const items = await scrapeList();
  console.log(`GPU list records: ${items.length}`);

  await scrapeDetails(items);

  const verification = buildVerificationReport(items);
  const meta = {
    generatedAt: new Date().toISOString(),
    listRecordsStored: items.length,
    detailRecordsStored: items.filter((gpu) => gpu.g3dMark != null).length,
    source: "PassMark",
    sourceUrl: "https://www.videocardbenchmark.net/gpu_list.php",
  };

  writeJson(GPU_PATH, items);
  writeJson(META_PATH, meta);
  writeJson(VERIFY_PATH, verification);

  console.log(JSON.stringify({ meta, verificationSummary: { missing: verification.missingDetails.length, incomplete: verification.incomplete.length, mismatched: verification.mismatched.length } }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
