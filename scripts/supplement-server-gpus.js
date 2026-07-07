const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const GPU_PATH = path.join(DATA_DIR, "gpus.json");
const META_PATH = path.join(DATA_DIR, "gpu-meta.json");
const VERIFY_PATH = path.join(DATA_DIR, "gpu-verification-report.json");
const CACHE_DIR = path.join(DATA_DIR, "source-cache", "gpu-supplemental");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
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
            "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode || 0, body: data });
          });
        }
      )
      .on("error", reject);
  });
}

async function fetchCached(url, file) {
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, "utf8");
  }
  const result = await requestText(url);
  if (result.status !== 200 || !result.body) {
    throw new Error(`Failed to fetch ${url}: ${result.status}`);
  }
  fs.writeFileSync(file, result.body, "utf8");
  return result.body;
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

function extractTcValue(text, label) {
  const match = text.match(new RegExp(`${escapeRegExp(label)}\\n([^\\n]+)`));
  return match ? match[1].trim() : null;
}

function cleanValue(value) {
  if (value == null) return null;
  const cleaned = String(value)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+Watt\b/gi, " W")
    .replace(/\s+GB\/s\b/gi, " GB/s")
    .replace(/\s+TB\/s\b/gi, " TB/s")
    .replace(/\s+Bit\b/gi, " Bit")
    .replace(/\s+MHz\b/gi, " MHz")
    .replace(/\s+TFLOPS\b/gi, " TFLOPS")
    .trim();
  if (!cleaned || /^n\/a$/i.test(cleaned)) return "N/A";
  return cleaned;
}

function parseNumeric(value) {
  if (value == null) return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function parseMemoryGb(value) {
  const num = parseNumeric(value);
  if (num == null) return null;
  const text = String(value).toUpperCase();
  if (text.includes("TB")) return num * 1024;
  if (text.includes("MB")) return num / 1024;
  return num;
}

function buildVerificationReport(items) {
  const passmarkItems = items.filter((gpu) => gpu.source?.primary === "PassMark");
  return {
    generatedAt: new Date().toISOString(),
    listCount: passmarkItems.length,
    detailCount: passmarkItems.filter((gpu) => gpu.g3dMark != null).length,
    coverageComplete: passmarkItems.every((gpu) => gpu.g3dMark != null),
    supplementalCount: items.length - passmarkItems.length,
    missingDetails: passmarkItems.filter((gpu) => gpu.g3dMark == null).map((gpu) => ({ id: gpu.id, name: gpu.name })),
    incomplete: items
      .filter((gpu) => gpu.verification?.missingFields?.length)
      .map((gpu) => ({ id: gpu.id, name: gpu.name, missingFields: gpu.verification.missingFields })),
    mismatched: passmarkItems
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

function computeMissingFields(gpu) {
  const required = [
    "busInterface",
    "maxMemorySize",
    "coreClock",
    "memoryClock",
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

function applyTechnicalCityFields(gpu, tcText) {
  const value = (label) => cleanValue(extractTcValue(tcText, label));
  const mapping = {
    busInterface: value("Interface"),
    maxMemorySize: value("Maximum RAM amount"),
    coreClock: value("Core clock speed"),
    boostClock: value("Boost clock speed"),
    memoryClock: value("Memory clock speed"),
    memoryType: value("Memory type"),
    memoryBusWidth: value("Memory bus width"),
    memoryBandwidth: value("Memory bandwidth"),
    openGL: value("OpenGL"),
    maxTdp: value("Power consumption (TDP)"),
    architecture: value("Architecture"),
    gpuCodeName: value("GPU code name"),
    releaseDate: value("Release date"),
    manufacturingProcess: value("Manufacturing process technology"),
    transistors: value("Number of transistors"),
    tensorCores: value("Tensor Cores"),
    rtCores: value("Ray Tracing Cores"),
    fp32Tflops: value("Floating-point processing power"),
    displayConnectors: value("Display Connectors"),
    openCL: value("OpenCL"),
    vulkan: value("Vulkan"),
    cuda: value("CUDA"),
    shaderModel: value("Shader Model"),
    shadingUnits: value("CUDA cores") || value("Shading units"),
    tmus: value("TMUs"),
    rops: value("ROPs"),
    l1Cache: value("L1 Cache"),
    l2Cache: value("L2 Cache"),
  };

  for (const [field, fieldValue] of Object.entries(mapping)) {
    if (fieldValue != null) {
      gpu[field] = fieldValue;
    }
  }
}

function applyOverrides(gpu, overrides = {}) {
  for (const [field, value] of Object.entries(overrides)) {
    if (value != null) {
      gpu[field] = value;
    }
  }
}

function createSupplementRecord(spec) {
  return {
    id: spec.id,
    name: spec.name,
    brand: spec.brand,
    busInterface: null,
    maxMemorySize: null,
    coreClock: null,
    boostClock: null,
    memoryClock: null,
    memoryType: null,
    memoryBusWidth: null,
    memoryBandwidth: null,
    directx: null,
    openGL: null,
    openCL: null,
    vulkan: null,
    cuda: null,
    shaderModel: null,
    maxTdp: null,
    videocardCategory: "Server",
    otherNames: spec.otherNames || null,
    firstBenchmarked: null,
    releaseDate: null,
    architecture: null,
    gpuCodeName: null,
    manufacturingProcess: null,
    transistors: null,
    shadingUnits: null,
    tmus: null,
    rops: null,
    tensorCores: null,
    rtCores: null,
    l1Cache: null,
    l2Cache: null,
    fp16: null,
    fp32Tflops: null,
    fp64: null,
    displayConnectors: null,
    g3dMarkPrice: null,
    overallRank: null,
    lastPriceChangeUsd: null,
    lastPriceChangeDate: null,
    g3dMark: null,
    g2dMark: null,
    samples: null,
    directx9Frames: null,
    directx10Frames: null,
    directx11Frames: null,
    directx12Frames: null,
    gpuComputeOps: null,
    source: {
      primary: "Technical City",
      detailUrl: spec.tcUrl,
      officialUrls: spec.officialUrls || [],
    },
    verification: {
      listVsDetailG3dMatch: null,
      listVsDetailRankMatch: null,
      missingFields: [],
    },
    scrapedAt: new Date().toISOString(),
  };
}

const TARGETS = [
  {
    mode: "update",
    matchId: "4039",
    cacheKey: "Tesla-P100-PCIe-16-GB",
    tcUrl: "https://technical.city/en/video/Tesla-P100-PCIe-16-GB",
    officialUrls: ["https://www.techpowerup.com/gpu-specs/tesla-p100-pcie-16-gb.c2888"],
    overrides: {
      brand: "NVIDIA",
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      maxMemorySize: "16 GB",
      memoryType: "HBM2",
    },
  },
  {
    mode: "update",
    matchId: "4226",
    cacheKey: "Tesla-V100-PCIe-16-GB",
    tcUrl: "https://technical.city/en/video/Tesla-V100-PCIe-16-GB",
    officialUrls: [
      "https://www.nvidia.com/en-gb/data-center/tesla-v100/",
      "https://www.nvidia.com/content/dam/en-zz/Solutions/Data-Center/tesla-product-literature/Tesla-V100-PCIe-Product-Brief.pdf",
    ],
    overrides: {
      brand: "NVIDIA",
      videocardCategory: "Server",
      maxMemorySize: "16 GB",
      memoryType: "HBM2",
      memoryBandwidth: "900 GB/s",
      maxTdp: "250 W",
      displayConnectors: "No outputs",
      fp16: "112 TFLOPS",
      fp64: "7 TFLOPS",
      openGL: "4.6",
      openCL: "1.2",
      vulkan: "1.2.131",
    },
  },
  {
    mode: "update",
    matchId: "4105",
    cacheKey: "Tesla-V100-SXM2-16-GB",
    tcUrl: "https://technical.city/en/video/Tesla-V100-SXM2-16-GB",
    officialUrls: ["https://www.nvidia.com/en-gb/data-center/tesla-v100/"],
    overrides: {
      brand: "NVIDIA",
      videocardCategory: "Server",
      busInterface: "SXM2 / NVLink",
      maxMemorySize: "16 GB",
      memoryType: "HBM2",
      memoryBandwidth: "900 GB/s",
      maxTdp: "300 W",
      displayConnectors: "No outputs",
      fp16: "125 TFLOPS",
      fp64: "7.8 TFLOPS",
      openGL: "4.6",
      openCL: "1.2",
      vulkan: "1.2.131",
    },
  },
  {
    mode: "insert",
    id: "supp-nvidia-a100-pcie-40gb",
    name: "NVIDIA A100 PCIe 40 GB",
    brand: "NVIDIA",
    cacheKey: "A100-PCIe-40-GB",
    tcUrl: "https://technical.city/en/video/A100-PCIe-40-GB",
    officialUrls: ["https://www.nvidia.com/en-us/data-center/a100/"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      maxMemorySize: "40 GB",
      memoryType: "HBM2",
      memoryBandwidth: "1,555 GB/s",
      maxTdp: "250 W",
      fp16: "312 TFLOPS",
      fp64: "9.7 TFLOPS",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-nvidia-a100-pcie-80gb",
    name: "NVIDIA A100 PCIe 80 GB",
    brand: "NVIDIA",
    cacheKey: "A100-PCIe-80-GB",
    tcUrl: "https://technical.city/en/video/A100-PCIe-80-GB",
    officialUrls: ["https://www.nvidia.com/en-us/data-center/a100/"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      maxMemorySize: "80 GB",
      memoryType: "HBM2e",
      memoryBandwidth: "1,935 GB/s",
      maxTdp: "300 W",
      fp16: "312 TFLOPS",
      fp64: "9.7 TFLOPS",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-nvidia-a100-sxm4-80gb",
    name: "NVIDIA A100 SXM4 80 GB",
    brand: "NVIDIA",
    cacheKey: "A100-SXM4-80-GB",
    tcUrl: "https://technical.city/en/video/A100-SXM4-80-GB",
    officialUrls: ["https://www.nvidia.com/en-us/data-center/a100/"],
    overrides: {
      videocardCategory: "Server",
      busInterface: "SXM4 / NVLink",
      displayConnectors: "No outputs",
      maxMemorySize: "80 GB",
      memoryType: "HBM2e",
      memoryBandwidth: "2,039 GB/s",
      maxTdp: "400 W",
      fp16: "624 TFLOPS",
      fp64: "9.7 TFLOPS",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-nvidia-h100-pcie-80gb",
    name: "NVIDIA H100 PCIe 80 GB",
    brand: "NVIDIA",
    cacheKey: "H100-PCIe-80-GB",
    tcUrl: "https://technical.city/en/video/H100-PCIe-80-GB",
    officialUrls: ["https://www.nvidia.com/en-us/data-center/h100/"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      maxMemorySize: "80 GB",
      memoryType: "HBM2e",
      maxTdp: "350 W",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-nvidia-h100-sxm5-80gb",
    name: "NVIDIA H100 SXM5 80 GB",
    brand: "NVIDIA",
    cacheKey: "H100-SXM5-80-GB",
    tcUrl: "https://technical.city/en/video/H100-SXM5-80-GB",
    officialUrls: ["https://www.nvidia.com/en-us/data-center/h100/"],
    overrides: {
      videocardCategory: "Server",
      busInterface: "SXM5 / NVLink",
      displayConnectors: "No outputs",
      maxMemorySize: "80 GB",
      memoryBandwidth: "3.35 TB/s",
      maxTdp: "700 W",
      fp16: "1,979 TFLOPS",
      fp64: "34 TFLOPS",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-nvidia-h200-nvl-141gb",
    name: "NVIDIA H200 NVL 141 GB",
    brand: "NVIDIA",
    cacheKey: "H200-NVL",
    tcUrl: "https://technical.city/en/video/H200-NVL",
    officialUrls: ["https://www.nvidia.com/en-us/data-center/h200/"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      maxMemorySize: "141 GB",
      memoryType: "HBM3e",
      memoryBandwidth: "4.8 TB/s",
      maxTdp: "600 W",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-amd-instinct-mi300x",
    name: "AMD Instinct MI300X",
    brand: "AMD",
    cacheKey: "Radeon-Instinct-MI300X",
    tcUrl: "https://technical.city/en/video/Radeon-Instinct-MI300X",
    officialUrls: ["https://www.amd.com/en/products/accelerators/instinct/mi300/mi300x.html"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      boostClock: "2100 MHz",
      transistors: "153,000 million",
      manufacturingProcess: "TSMC 5nm | 6nm FinFET",
      maxTdp: "750 W",
      memoryType: "HBM3",
      maxMemorySize: "192 GB",
      memoryBusWidth: "8192 Bit",
      memoryClock: "5.2 GHz",
      memoryBandwidth: "5.3 TB/s",
      fp16: "1.3 PFLOPS",
      fp32Tflops: "163.4 TFLOPS",
      fp64: "81.7 TFLOPS",
      tensorCores: "1216",
      shadingUnits: "19456",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-amd-instinct-mi325x",
    name: "AMD Instinct MI325X",
    brand: "AMD",
    cacheKey: "Radeon-Instinct-MI325X",
    tcUrl: "https://technical.city/en/video/Radeon-Instinct-MI325X",
    officialUrls: ["https://www.amd.com/en/products/accelerators/instinct/mi300/mi325x.html"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      boostClock: "2100 MHz",
      transistors: "153,000 million",
      manufacturingProcess: "TSMC 5nm | 6nm FinFET",
      maxTdp: "1000 W",
      memoryType: "HBM3E",
      maxMemorySize: "256 GB",
      memoryBusWidth: "8192 Bit",
      memoryClock: "6 GHz",
      memoryBandwidth: "6 TB/s",
      fp16: "1.3 PFLOPS",
      fp32Tflops: "163.4 TFLOPS",
      fp64: "81.7 TFLOPS",
      tensorCores: "1216",
      shadingUnits: "19456",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-amd-instinct-mi350x",
    name: "AMD Instinct MI350X",
    brand: "AMD",
    cacheKey: "Radeon-Instinct-MI350X",
    tcUrl: "https://technical.city/en/video/Radeon-Instinct-MI350X",
    officialUrls: ["https://www.amd.com/en/products/accelerators/instinct/mi350/mi350x.html"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      architecture: "CDNA4",
      releaseDate: "12 June 2025",
      boostClock: "2200 MHz",
      transistors: "185,000 million",
      manufacturingProcess: "TSMC 3nm | 6nm FinFET",
      maxTdp: "1000 W",
      memoryType: "HBM3E",
      maxMemorySize: "288 GB",
      memoryBusWidth: "8192 Bit",
      memoryClock: "8 GHz",
      memoryBandwidth: "8 TB/s",
      fp16: "144.2 TFLOPS",
      fp32Tflops: "144.2 TFLOPS",
      fp64: "72.1 TFLOPS",
      tensorCores: "1024",
      shadingUnits: "16384",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
  {
    mode: "insert",
    id: "supp-amd-instinct-mi355x",
    name: "AMD Instinct MI355X",
    brand: "AMD",
    cacheKey: "Radeon-Instinct-MI355X",
    tcUrl: "https://technical.city/en/video/Radeon-Instinct-MI355X",
    officialUrls: ["https://www.amd.com/en/products/accelerators/instinct/mi350/mi355x.html"],
    overrides: {
      videocardCategory: "Server",
      displayConnectors: "No outputs",
      architecture: "CDNA4",
      releaseDate: "12 June 2025",
      boostClock: "2400 MHz",
      transistors: "185,000 million",
      manufacturingProcess: "TSMC 3nm | 6nm FinFET",
      maxTdp: "1400 W",
      memoryType: "HBM3E",
      maxMemorySize: "288 GB",
      memoryBandwidth: "8 TB/s",
      fp16: "157.3 TFLOPS",
      fp32Tflops: "157.3 TFLOPS",
      fp64: "78.6 TFLOPS",
      tensorCores: "1024",
      shadingUnits: "16384",
      openGL: "N/A",
      vulkan: "N/A",
    },
  },
];

async function enrichTarget(gpus, spec) {
  let gpu = null;
  let inserted = false;

  if (spec.mode === "update") {
    gpu = gpus.find((item) => String(item.id) === String(spec.matchId));
    if (!gpu) {
      throw new Error(`Could not find existing GPU id=${spec.matchId} (${spec.tcUrl})`);
    }
  } else {
    gpu = gpus.find((item) => String(item.id) === String(spec.id));
    if (!gpu) {
      gpu = createSupplementRecord(spec);
      gpus.push(gpu);
      inserted = true;
    }
  }

  const cacheFile = path.join(CACHE_DIR, `${spec.cacheKey}.html`);
  const html = await fetchCached(spec.tcUrl, cacheFile);
  const tcText = normalizeText(html);

  applyTechnicalCityFields(gpu, tcText);
  applyOverrides(gpu, spec.overrides);

  gpu.brand = spec.brand || gpu.brand;
  gpu.source = {
    primary: spec.mode === "update" ? gpu.source?.primary || "PassMark" : "Technical City",
    listUrl: gpu.source?.listUrl || null,
    detailUrl: spec.tcUrl,
    officialUrls: spec.officialUrls || [],
  };
  gpu.scrapedAt = new Date().toISOString();

  computeMissingFields(gpu);

  return {
    id: gpu.id,
    name: gpu.name,
    inserted,
    missingFields: gpu.verification.missingFields,
  };
}

async function main() {
  ensureDir(CACHE_DIR);

  const gpus = readJson(GPU_PATH, []);
  const results = [];

  for (const spec of TARGETS) {
    const result = await enrichTarget(gpus, spec);
    results.push(result);
    console.log(`${result.inserted ? "inserted" : "updated"} ${result.id} ${result.name}`);
  }

  gpus.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "en"));

  const verification = buildVerificationReport(gpus);
  const meta = readJson(META_PATH, {});
  meta.supplemental = {
    updatedAt: new Date().toISOString(),
    entriesTouched: results.length,
    inserted: results.filter((item) => item.inserted).length,
    updated: results.filter((item) => !item.inserted).length,
    sources: ["technical.city", "NVIDIA", "AMD"],
  };

  writeJson(GPU_PATH, gpus);
  writeJson(META_PATH, meta);
  writeJson(VERIFY_PATH, verification);

  console.log(
    JSON.stringify(
      {
        supplemental: meta.supplemental,
        sample: results,
        verificationSummary: {
          totalRecords: gpus.length,
          passmarkRecords: verification.listCount,
          supplementalCount: verification.supplementalCount,
          incomplete: verification.incomplete.length,
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
