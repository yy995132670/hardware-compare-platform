const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const GPU_PATH = path.join(DATA_DIR, "gpus.json");
const META_PATH = path.join(DATA_DIR, "gpu-meta.json");
const VERIFY_PATH = path.join(DATA_DIR, "gpu-verification-report.json");
const CACHE_DIR = path.join(DATA_DIR, "source-cache", "gpu-enrich");
const TECH_SEARCH_DIR = path.join(CACHE_DIR, "technical-city-search");
const TECH_PAGE_DIR = path.join(CACHE_DIR, "technical-city-pages");
const XIN_DIR = path.join(CACHE_DIR, "xincanshu");
const CONCURRENCY = Number(process.env.GPU_ENRICH_CONCURRENCY || 6);
const LIMIT = Number(process.env.GPU_ENRICH_LIMIT || 0);

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

function requestText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
            ...headers,
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

async function fetchCached(url, file, headers = {}) {
  if (fs.existsSync(file)) {
    return { status: 200, body: fs.readFileSync(file, "utf8"), cached: true };
  }

  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await requestText(url, headers);
      if (result.status === 200 && result.body) {
        fs.writeFileSync(file, result.body, "utf8");
      }
      return { ...result, cached: false };
    } catch (error) {
      lastError = error;
      await sleep(350 * (attempt + 1));
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeXinValue(text) {
  return String(text || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function normalizeLookupName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\bnvidia\b|\bnvidia\b|\bnvidia corporation\b|\bnvidia tesla\b/g, "nvidia")
    .replace(/\bamd\b|\bati\b/g, "amd")
    .replace(/\bintel corporation\b/g, "intel")
    .replace(/\bvideo card\b|\bgraphics\b/g, "")
    .replace(/\bserver edition\b/g, "server")
    .replace(/\bworkstation edition\b/g, "workstation")
    .replace(/\bmobile\b/g, "mobile")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityScore(a, b) {
  const left = normalizeLookupName(a);
  const right = normalizeLookupName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.9;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return overlap / Math.max(leftTokens.size, rightTokens.size, 1);
}

function mergeField(gpu, key, value, source, force = false) {
  if (value == null || value === "" || value === "NA") {
    return false;
  }
  if (!force && gpu[key] != null && gpu[key] !== "") {
    return false;
  }
  gpu[key] = value;
  gpu.enrichment = gpu.enrichment || { sources: [] };
  gpu.enrichment.sources.push({
    field: key,
    source,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

function canonicalBrand(name, currentBrand) {
  const value = String(name || currentBrand || "").toLowerCase();
  if (value.includes("nvidia") || value.includes("geforce") || value.includes("quadro") || value.includes("tesla") || value.includes("rtx")) {
    return "NVIDIA";
  }
  if (value.includes("amd") || value.includes("radeon") || value.includes("instinct") || value.includes("firepro")) {
    return "AMD";
  }
  if (value.includes("intel") || value.includes("arc") || value.includes("iris") || value.includes("uhd")) {
    return "Intel";
  }
  return currentBrand || String(name || "").split(" ")[0];
}

function xincanshuSlug(text) {
  return String(text || "")
    .replace(/\(.*?\)/g, "")
    .replace(/\+/g, "plus")
    .replace(/@/g, "")
    .replace(/[-/\s]+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildXinCandidates(gpu) {
  const brand = canonicalBrand(gpu.name, gpu.brand);
  const name = String(gpu.name || "").replace(/^\s+|\s+$/g, "");
  const variants = new Set();
  variants.add(xincanshuSlug(`${brand} ${name}`));
  variants.add(xincanshuSlug(name));

  if (!name.toLowerCase().startsWith(brand.toLowerCase())) {
    variants.add(xincanshuSlug(`${brand}_${name}`));
  }

  if (brand === "AMD" && /instinct/i.test(name) && !/radeon/i.test(name)) {
    variants.add(xincanshuSlug(`AMD Radeon ${name}`));
  }

  return [...variants].filter(Boolean);
}

function parseXinPairs(html) {
  return new Map(
    [...html.matchAll(/data-skey="([^"]+)"[^>]*data-svalue="([^"]*)"/g)].map((match) => [match[1], decodeXinValue(match[2])])
  );
}

function parseXinCategory(gpu) {
  const name = String(gpu.name || "").toLowerCase();
  if (name.includes("tesla") || name.includes("instinct") || name.includes("l40") || name.includes("a100") || name.includes("h100")) {
    return "Server";
  }
  if (name.includes("quadro") || name.includes("rtx pro") || name.includes("radeon pro") || name.includes("firepro")) {
    return "Workstation";
  }
  if (name.includes("mobile") || name.includes("laptop") || name.includes("max-q")) {
    return "Laptop";
  }
  return "Desktop";
}

function enrichFromXin(gpu, pairs) {
  let changed = 0;
  const mapping = [
    ["busInterface", pairs.get("总线接口")],
    ["maxMemorySize", pairs.get("显存大小")],
    ["coreClock", pairs.get("核心频率") || pairs.get("GPU频率")],
    ["boostClock", pairs.get("Turbo频率")],
    ["memoryClock", pairs.get("显存频率")],
    ["memoryType", pairs.get("显存类型") || pairs.get("内存类型")],
    ["memoryBusWidth", pairs.get("显存位宽")],
    ["memoryBandwidth", pairs.get("显存带宽")],
    ["openGL", pairs.get("OpenGL")],
    ["maxTdp", pairs.get("TDP") || pairs.get("TDP功耗")],
    ["videocardCategory", parseXinCategory(gpu)],
    ["architecture", pairs.get("核心架构") || pairs.get("显卡架构")],
    ["gpuCodeName", pairs.get("核心代号")],
    ["releaseDate", pairs.get("发布日期")],
    ["manufacturingProcess", pairs.get("制作工艺")],
    ["transistors", pairs.get("晶体管数量")],
    ["tensorCores", pairs.get("Tensor Cores")],
    ["rtCores", pairs.get("RT Cores")],
    ["fp16", pairs.get("FP16 (半精度)")],
    ["fp32Tflops", pairs.get("FP32 (单精度)")],
    ["fp64", pairs.get("FP64 (双精度)")],
    ["l1Cache", pairs.get("L1 Cache")],
    ["l2Cache", pairs.get("L2 Cache")],
    ["shadingUnits", pairs.get("Shading Units")],
    ["tmus", pairs.get("TMUs")],
    ["rops", pairs.get("ROPs")],
    ["displayConnectors", pairs.get("输出接口")],
    ["cuda", pairs.get("CUDA")],
    ["openCL", pairs.get("OpenCL")],
    ["vulkan", pairs.get("Vulkan")],
    ["shaderModel", pairs.get("Shader Model")],
  ];

  for (const [field, value] of mapping) {
    if (mergeField(gpu, field, value, "芯参数")) {
      changed += 1;
    }
  }

  return changed;
}

function extractTcValue(text, label) {
  const match = text.match(new RegExp(`${escapeRegExp(label)}\\n([^\\n]+)`));
  return match ? match[1].trim() : null;
}

function cleanTcValue(value) {
  return String(value || "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+MHz/g, " MHz")
    .replace(/\s+GB\/s/g, " GB/s")
    .replace(/\s+TB\/s/g, " TB/s")
    .replace(/\s+Bit/g, " Bit")
    .replace(/\s+Watt/g, " W")
    .replace(/\s+TFLOPS/g, " TFLOPS")
    .trim();
}

function parseTcCategory(value) {
  const lowered = String(value || "").toLowerCase();
  if (lowered.includes("workstation")) return "Workstation";
  if (lowered.includes("desktop")) return "Desktop";
  if (lowered.includes("laptop")) return "Laptop";
  if (lowered.includes("server")) return "Server";
  return value || null;
}

function enrichFromTechnicalCity(gpu, text) {
  let changed = 0;
  const mapping = [
    ["architecture", extractTcValue(text, "Architecture")],
    ["gpuCodeName", extractTcValue(text, "GPU code name")],
    ["videocardCategory", parseTcCategory(extractTcValue(text, "Market segment"))],
    ["releaseDate", extractTcValue(text, "Release date")],
    ["coreClock", extractTcValue(text, "Core clock speed")],
    ["boostClock", extractTcValue(text, "Boost clock speed")],
    ["transistors", extractTcValue(text, "Number of transistors")],
    ["manufacturingProcess", extractTcValue(text, "Manufacturing process technology")],
    ["maxTdp", extractTcValue(text, "Power consumption (TDP)")],
    ["fp32Tflops", extractTcValue(text, "Floating-point processing power")],
    ["rops", extractTcValue(text, "ROPs")],
    ["tmus", extractTcValue(text, "TMUs")],
    ["tensorCores", extractTcValue(text, "Tensor Cores")],
    ["rtCores", extractTcValue(text, "Ray Tracing Cores")],
    ["l1Cache", extractTcValue(text, "L1 Cache")],
    ["l2Cache", extractTcValue(text, "L2 Cache")],
    ["busInterface", extractTcValue(text, "Interface")],
    ["maxMemorySize", extractTcValue(text, "Maximum RAM amount")],
    ["memoryType", extractTcValue(text, "Memory type")],
    ["memoryBusWidth", extractTcValue(text, "Memory bus width")],
    ["memoryClock", extractTcValue(text, "Memory clock speed")],
    ["memoryBandwidth", extractTcValue(text, "Memory bandwidth")],
    ["displayConnectors", extractTcValue(text, "Display Connectors")],
    ["directx", extractTcValue(text, "DirectX")],
    ["shaderModel", extractTcValue(text, "Shader Model")],
    ["openGL", extractTcValue(text, "OpenGL")],
    ["openCL", extractTcValue(text, "OpenCL")],
    ["vulkan", extractTcValue(text, "Vulkan")],
    ["cuda", extractTcValue(text, "CUDA")],
    ["shadingUnits", extractTcValue(text, "CUDA cores") || extractTcValue(text, "Shading units")],
  ];

  for (const [field, rawValue] of mapping) {
    const value = cleanTcValue(rawValue);
    if (mergeField(gpu, field, value, "technical.city")) {
      changed += 1;
    }
  }

  return changed;
}

function parseTechCandidates(html) {
  const candidates = [];
  for (const match of html.matchAll(/href="(\/en\/video\/[^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    const href = match[1];
    const label = match[2].trim();
    if (
      href.includes("/rating") ||
      href.includes("best-price") ||
      !label ||
      label.toLowerCase().includes("rating")
    ) {
      continue;
    }
    candidates.push({ href, label });
  }

  const unique = [];
  const seen = new Set();
  for (const item of candidates) {
    const key = `${item.href}|${item.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  }
  return unique;
}

async function fetchTechnicalCityPage(gpu) {
  const searchCache = path.join(TECH_SEARCH_DIR, `${gpu.id}.html`);
  const searchResult = await fetchCached(`https://technical.city/en/search?q=${encodeURIComponent(gpu.name)}`, searchCache);
  if (searchResult.status !== 200 || !searchResult.body) {
    return null;
  }

  const candidates = parseTechCandidates(searchResult.body)
    .map((item) => ({
      ...item,
      score: similarityScore(gpu.name, item.label),
    }))
    .sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best || best.score < 0.34) {
    return null;
  }

  const slug = best.href.split("/").pop();
  const pageCache = path.join(TECH_PAGE_DIR, `${slug}.html`);
  const detailResult = await fetchCached(`https://technical.city${best.href}`, pageCache);
  if (detailResult.status !== 200 || !detailResult.body || /Page not found/i.test(detailResult.body)) {
    return null;
  }

  return {
    href: best.href,
    label: best.label,
    text: normalizeText(detailResult.body),
  };
}

async function fetchXinPage(gpu) {
  const candidates = buildXinCandidates(gpu);
  for (const slug of candidates) {
    const cache = path.join(XIN_DIR, `${slug}.html`);
    const result = await fetchCached(`https://www.xincanshu.com/gpu/${slug}/canshu.html`, cache, {
      Referer: "https://www.xincanshu.com/",
    });
    if (result.status === 200 && result.body && !/404 Not Found|内容找不到了/i.test(result.body)) {
      return result.body;
    }
  }
  return null;
}

function needsEnrichment(gpu) {
  const required = [
    "busInterface",
    "maxMemorySize",
    "coreClock",
    "memoryClock",
    "openGL",
    "maxTdp",
    "videocardCategory",
    "memoryType",
    "memoryBusWidth",
    "memoryBandwidth",
    "architecture",
    "gpuCodeName",
    "releaseDate",
    "manufacturingProcess",
    "transistors",
    "tensorCores",
    "rtCores",
    "fp32Tflops",
  ];

  return required.some((field) => gpu[field] == null || gpu[field] === "");
}

function deriveBandwidthFromClock(gpu) {
  if (gpu.memoryBandwidth) {
    return null;
  }
  const bus = String(gpu.memoryBusWidth || "").match(/(\d+(?:\.\d+)?)\s*bit/i);
  const gbps = String(gpu.memoryClock || "").match(/(\d+(?:\.\d+)?)\s*Gbps/i);
  if (!bus || !gbps) {
    return null;
  }
  const value = (Number(bus[1]) / 8) * Number(gbps[1]);
  return Number.isFinite(value) ? `${value.toFixed(1)} GB/s` : null;
}

function deriveCategory(gpu) {
  if (gpu.videocardCategory) {
    return null;
  }
  const name = String(gpu.name || "").toLowerCase();
  if (name.includes("server edition") || /(tesla|instinct|grid|l40|a100|h100|b200|gb200|gb300)/.test(name)) {
    return "Server";
  }
  if (name.includes("workstation edition") || /(quadro|rtx pro|radeon pro|firepro)/.test(name)) {
    return "Workstation";
  }
  if (/(mobile|max-q|laptop)/.test(name)) {
    return "Laptop";
  }
  if (/(uhd graphics|iris|igp)/.test(name)) {
    return "Integrated";
  }
  return "Desktop";
}

function recomputeVerification(gpu) {
  if (gpu.memoryBandwidth == null || gpu.memoryBandwidth === "") {
    const derivedBandwidth = deriveBandwidthFromClock(gpu);
    if (derivedBandwidth) {
      gpu.memoryBandwidth = derivedBandwidth;
    }
  }
  if (gpu.videocardCategory == null || gpu.videocardCategory === "") {
    const derivedCategory = deriveCategory(gpu);
    if (derivedCategory) {
      gpu.videocardCategory = derivedCategory;
    }
  }

  const required = [
    "busInterface",
    "maxMemorySize",
    "coreClock",
    "memoryClock",
    "openGL",
    "maxTdp",
    "videocardCategory",
    "memoryType",
    "memoryBusWidth",
    "memoryBandwidth",
    "architecture",
    "gpuCodeName",
    "releaseDate",
    "manufacturingProcess",
  ];

  gpu.verification = gpu.verification || {};
  gpu.verification.missingFields = required.filter((field) => gpu[field] == null || gpu[field] === "");
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

function buildVerificationReport(items) {
  return {
    generatedAt: new Date().toISOString(),
    listCount: items.length,
    detailCount: items.filter((gpu) => gpu.g3dMark != null).length,
    coverageComplete: items.every((gpu) => gpu.g3dMark != null),
    missingDetails: items.filter((gpu) => gpu.g3dMark == null).map((gpu) => ({ id: gpu.id, name: gpu.name })),
    incomplete: items
      .filter((gpu) => gpu.verification?.missingFields?.length)
      .map((gpu) => ({ id: gpu.id, name: gpu.name, missingFields: gpu.verification.missingFields })),
    mismatched: items
      .filter((gpu) => gpu.verification && (!gpu.verification.listVsDetailG3dMatch || !gpu.verification.listVsDetailRankMatch))
      .map((gpu) => ({
        id: gpu.id,
        name: gpu.name,
        listG3dMark: gpu.listG3dMark,
        detailG3dMark: gpu.g3dMark,
        listOverallRank: gpu.listOverallRank,
        detailOverallRank: gpu.overallRank,
      })),
  };
}

async function enrichGpu(gpu) {
  let changed = 0;

  const xinHtml = await fetchXinPage(gpu);
  if (xinHtml) {
    changed += enrichFromXin(gpu, parseXinPairs(xinHtml));
  }

  const tcPage = await fetchTechnicalCityPage(gpu);
  if (tcPage) {
    changed += enrichFromTechnicalCity(gpu, tcPage.text);
  }

  recomputeVerification(gpu);
  return changed;
}

async function main() {
  ensureDir(CACHE_DIR);
  ensureDir(TECH_SEARCH_DIR);
  ensureDir(TECH_PAGE_DIR);
  ensureDir(XIN_DIR);

  const gpus = readJson(GPU_PATH, []);
  const targets = gpus.filter(needsEnrichment);
  const list = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  let changedCount = 0;

  console.log(`Need GPU enrichment: ${list.length}`);

  await runPool(
    list,
    async (gpu) => {
      try {
        const changed = await enrichGpu(gpu);
        if (changed > 0) {
          changedCount += 1;
        }
      } catch (error) {
        console.error(`GPU enrichment failed for ${gpu.id} ${gpu.name}: ${error.message}`);
      }
    },
    CONCURRENCY
  );

  const verification = buildVerificationReport(gpus);
  const meta = readJson(META_PATH, {});
  meta.enrichment = {
    updatedAt: new Date().toISOString(),
    changedGpuRecords: changedCount,
    attemptedGpuRecords: list.length,
    sources: ["technical.city", "芯参数"],
  };

  writeJson(GPU_PATH, gpus);
  writeJson(META_PATH, meta);
  writeJson(VERIFY_PATH, verification);

  console.log(
    JSON.stringify(
      {
        enrichment: meta.enrichment,
        verificationSummary: {
          incomplete: verification.incomplete.length,
          mismatched: verification.mismatched.length,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
