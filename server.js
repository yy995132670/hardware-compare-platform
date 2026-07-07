const express = require("express");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 2680);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");

const CPU_PATH = path.join(DATA_DIR, "cpus.json");
const CPU_META_PATH = path.join(DATA_DIR, "meta.json");
const CPU_VERIFY_PATH = path.join(DATA_DIR, "verification-report.json");

const GPU_PATH = path.join(DATA_DIR, "gpus.json");
const GPU_META_PATH = path.join(DATA_DIR, "gpu-meta.json");
const GPU_VERIFY_PATH = path.join(DATA_DIR, "gpu-verification-report.json");
const GPU_LLM_PATH = path.join(DATA_DIR, "gpu-llm-benchmarks.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sortByMetric(items, metric) {
  return [...items].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gpuSearchScore(gpu, q) {
  if (!q) return gpu.g3dMark || 0;

  const name = String(gpu.name || "").toLowerCase();
  const otherNames = String(gpu.otherNames || "").toLowerCase();
  const category = String(gpu.videocardCategory || "").toLowerCase();
  const boundaryPattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(q)}([^a-z0-9]|$)`);

  if (name === q) return 10000;
  if (name.startsWith(q)) return 9000;
  if (boundaryPattern.test(name)) return 8000;
  if (boundaryPattern.test(otherNames)) return 7000;
  if (name.includes(q)) return 6000;
  if (otherNames.includes(q)) return 5000;
  if (category.includes(q)) return 3000;
  return 0;
}

function createEnergyEstimate(tdpText, options) {
  const hoursPerDay = Number(options.hoursPerDay ?? 8);
  const utilizationPercent = Number(options.utilizationPercent ?? 25);
  const costPerKwh = Number(options.costPerKwh ?? 0.15);
  const maxTdpW = Number(String(tdpText || "").replace(/[^0-9.]/g, ""));

  if (!Number.isFinite(maxTdpW) || maxTdpW <= 0) {
    return {
      maxTdpW: null,
      powerConsumptionPerDayKwh: null,
      runningCostPerDay: null,
      powerConsumptionPerYearKwh: null,
      runningCostPerYear: null,
    };
  }

  const wattsAtLoad = maxTdpW * (utilizationPercent / 100);
  const powerConsumptionPerDayKwh = (wattsAtLoad * hoursPerDay) / 1000;
  const runningCostPerDay = powerConsumptionPerDayKwh * costPerKwh;
  const powerConsumptionPerYearKwh = powerConsumptionPerDayKwh * 365;
  const runningCostPerYear = runningCostPerDay * 365;

  return {
    maxTdpW,
    powerConsumptionPerDayKwh,
    runningCostPerDay,
    powerConsumptionPerYearKwh,
    runningCostPerYear,
  };
}

function cpuCategoryLabel(category) {
  if (category === "server") return "服务器";
  if (category === "desktop") return "桌面";
  if (category === "laptop") return "笔记本";
  return "其他";
}

function detectCpuCategory(cpu) {
  const value = String(cpu.cpuClass || "").toLowerCase();
  const name = String(cpu.name || "").toLowerCase();
  if (
    name.includes("epyc") ||
    name.includes("xeon") ||
    name.includes("opteron") ||
    name.includes("threadripper pro") ||
    value.includes("server")
  ) {
    return "server";
  }
  if (value.includes("desktop")) return "desktop";
  if (value.includes("laptop") || value.includes("mobile") || value.includes("notebook") || value.includes("embedded")) return "laptop";
  if (name.includes("core i") || name.includes("core ultra") || name.includes("ryzen")) {
    return value.includes("desktop") ? "desktop" : "laptop";
  }
  return "other";
}

function normalizeCpu(cpu) {
  const category = detectCpuCategory(cpu);
  return {
    id: String(cpu.id),
    name: cpu.name,
    brand: cpu.brand,
    cpuClass: cpu.cpuClass,
    socketType: cpu.socketType,
    clockspeed: cpu.clockspeed,
    turboSpeed: cpu.turboSpeed,
    physicalCores: cpu.physicalCores,
    threads: cpu.threads,
    physicalCoresText: cpu.physicalCoresText,
    cache: cpu.cache,
    tdp: cpu.tdp,
    firstSeenOnChart: cpu.firstSeenOnChart,
    cpuRank: cpu.cpuRank,
    singleThreadRank: cpu.singleThreadRank,
    cpuMark: cpu.cpuMark,
    singleThreadRating: cpu.singleThreadRating,
    cpuValue: cpu.cpuValue,
    listPriceUsd: cpu.listPriceUsd,
    memorySupport: cpu.memorySupport,
    sampleCount: cpu.sampleCount,
    verification: cpu.verification,
    source: cpu.source,
    scrapedAt: cpu.scrapedAt,
    category,
    categoryLabel: cpuCategoryLabel(category),
  };
}

function buildCpuComparePayload(cpus, options) {
  const maxSingleThread = Math.max(...cpus.map((cpu) => cpu.singleThreadRating || 0));
  const maxCpuMark = Math.max(...cpus.map((cpu) => cpu.cpuMark || 0));

  return {
    inputs: {
      hoursPerDay: Number(options.hoursPerDay ?? 8),
      utilizationPercent: Number(options.utilizationPercent ?? 25),
      costPerKwh: Number(options.costPerKwh ?? 0.15),
    },
    cpus: cpus.map((cpu) => ({
      ...normalizeCpu(cpu),
      singleThreadDiffToMaxPercent:
        cpu.singleThreadRating == null || maxSingleThread === 0 ? null : Number((((cpu.singleThreadRating - maxSingleThread) / maxSingleThread) * 100).toFixed(1)),
      cpuMarkDiffToMaxPercent:
        cpu.cpuMark == null || maxCpuMark === 0 ? null : Number((((cpu.cpuMark - maxCpuMark) / maxCpuMark) * 100).toFixed(1)),
      energyUsage: createEnergyEstimate(cpu.tdp, options),
    })),
  };
}

function gpuCategoryLabel(category) {
  if (category === "server") return "服务器";
  if (category === "workstation") return "工作站";
  if (category === "desktop") return "桌面";
  if (category === "laptop") return "笔记本";
  if (category === "integrated") return "集成显卡";
  return "其他";
}

function parseNumber(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!cleaned) return null;
  const num = Number(cleaned[0]);
  return Number.isFinite(num) ? num : null;
}

function parseMemorySizeGb(value) {
  const num = parseNumber(value);
  if (num == null) return null;
  const text = String(value).toUpperCase();
  if (text.includes("TB")) return num * 1024;
  if (text.includes("MB")) return num / 1024;
  return num;
}

function parseBandwidthGbps(value) {
  const num = parseNumber(value);
  if (num == null) return null;
  const text = String(value).toUpperCase();
  if (text.includes("TB/S")) return num * 1000;
  if (text.includes("MB/S")) return num / 1000;
  return num;
}

function parseTflops(value) {
  const num = parseNumber(value);
  if (num == null) return null;
  const text = String(value).toUpperCase();
  if (text.includes("GFLOPS")) return num / 1000;
  if (text.includes("PFLOPS")) return num * 1000;
  return num;
}

function deriveMemoryBandwidthGbps(gpu) {
  const explicit = parseBandwidthGbps(gpu.memoryBandwidth);
  if (explicit != null) return explicit;
  const busBits = parseNumber(gpu.memoryBusWidth);
  const clockText = String(gpu.memoryClock || "");
  const effectiveGbps = clockText.match(/(\d+(?:\.\d+)?)\s*Gbps/i);
  if (busBits && effectiveGbps) {
    return Number((Number(effectiveGbps[1]) * (busBits / 8)).toFixed(1));
  }
  return null;
}

function memoryTypeFactor(value) {
  const text = String(value || "").toUpperCase();
  if (text.includes("HBM3E")) return 1.18;
  if (text.includes("HBM3")) return 1.14;
  if (text.includes("HBM2E")) return 1.1;
  if (text.includes("HBM2")) return 1.06;
  if (text.includes("GDDR7")) return 1.03;
  if (text.includes("GDDR6X")) return 1.01;
  if (text.includes("GDDR6")) return 1;
  if (text.includes("GDDR5X")) return 0.92;
  if (text.includes("GDDR5")) return 0.88;
  if (text.includes("DDR")) return 0.75;
  if (text.includes("SHARED")) return 0.6;
  return 1;
}

function calculateGpuLlmTheoreticalRaw(gpu) {
  const vramGb = parseMemorySizeGb(gpu.maxMemorySize);
  const bandwidthGbps = deriveMemoryBandwidthGbps(gpu);
  const computeTflops = parseTflops(gpu.fp16) || parseTflops(gpu.fp32Tflops);

  if (vramGb == null && bandwidthGbps == null && computeTflops == null) {
    return null;
  }

  const capacityComponent = Math.max(vramGb || 4, 1);
  const bandwidthComponent = Math.max(bandwidthGbps || 50, 1);
  const computeComponent = Math.max(computeTflops || 0.5, 0.1);
  const raw =
    Math.pow(capacityComponent, 0.35) *
    Math.pow(bandwidthComponent, 0.45) *
    Math.pow(computeComponent, 0.2) *
    memoryTypeFactor(gpu.memoryType);

  return Number(raw.toFixed(6));
}

function detectGpuCategory(gpu) {
  const name = String(gpu.name || "").toLowerCase();
  const category = String(gpu.videocardCategory || "").toLowerCase();
  const serverNamePattern = /\b(tesla|grid|instinct|h100|h200|a100|a30|l4|l40|l40s|b200|b300|gb200|gb300|mi\d{3,4}[a-z]?)\b/;

  if (name.includes("server edition")) return "server";
  if (name.includes("workstation edition")) return "workstation";

  if (
    category.includes("server") ||
    category.includes("data center") ||
    category.includes("datacenter") ||
    serverNamePattern.test(name) ||
    /\bgaudi\b/.test(name)
  ) {
    return "server";
  }
  if (category.includes("workstation") || category.includes("professional") || /(quadro|rtx a\d|radeon pro|firepro|pro w)/.test(name)) {
    return "workstation";
  }
  if (category.includes("mobile") || category.includes("laptop") || /(laptop gpu|mobile|max-q|\bm\d{3,4}\b|\bmx\d+\b)/.test(name)) {
    return "laptop";
  }
  if (category.includes("integrated") || category.includes("igp") || /(uhd graphics|iris|vega \d|igp|arc graphics)/.test(name)) {
    return "integrated";
  }
  if (category.includes("desktop") || /(geforce|radeon rx|radeon hd|arc a\d|arc b\d)/.test(name)) {
    return "desktop";
  }
  return "other";
}

function normalizeLlmKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\(x\d+\)/g, "")
    .replace(/\b\d+gb\b/g, "")
    .replace(/\b\d+g\b/g, "")
    .replace(/\b\d+w\b/g, "")
    .replace(/\bhbm\d\w*\b/g, "")
    .replace(/\bserver edition\b/g, "")
    .replace(/\bpower cap\b/g, "")
    .replace(/\bpcie\b/g, "")
    .replace(/\bsxm-?\d*\b/g, "")
    .replace(/\br\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findGpuLlmBenchmark(gpu, llmData) {
  if (!llmData?.items?.length) return null;
  const gpuKey = normalizeLlmKey(gpu.name);
  const otherNamesKey = normalizeLlmKey(gpu.otherNames);
  return llmData.items.find((item) => item.key === gpuKey || (otherNamesKey && item.key === otherNamesKey)) || null;
}

function normalizeGpu(gpu, llmData) {
  const category = detectGpuCategory(gpu);
  const llmBenchmark = findGpuLlmBenchmark(gpu, llmData);
  return {
    id: String(gpu.id),
    name: gpu.name,
    brand: gpu.brand,
    busInterface: gpu.busInterface,
    maxMemorySize: gpu.maxMemorySize,
    coreClock: gpu.coreClock,
    boostClock: gpu.boostClock,
    memoryClock: gpu.memoryClock,
    memoryType: gpu.memoryType,
    memoryBusWidth: gpu.memoryBusWidth,
    memoryBandwidth: gpu.memoryBandwidth,
    directx: gpu.directx,
    openGL: gpu.openGL,
    openCL: gpu.openCL,
    vulkan: gpu.vulkan,
    cuda: gpu.cuda,
    shaderModel: gpu.shaderModel,
    maxTdp: gpu.maxTdp,
    videocardCategory: gpu.videocardCategory,
    otherNames: gpu.otherNames,
    firstBenchmarked: gpu.firstBenchmarked,
    releaseDate: gpu.releaseDate,
    architecture: gpu.architecture,
    gpuCodeName: gpu.gpuCodeName,
    manufacturingProcess: gpu.manufacturingProcess,
    transistors: gpu.transistors,
    shadingUnits: gpu.shadingUnits,
    tmus: gpu.tmus,
    rops: gpu.rops,
    tensorCores: gpu.tensorCores,
    rtCores: gpu.rtCores,
    l1Cache: gpu.l1Cache,
    l2Cache: gpu.l2Cache,
    fp16: gpu.fp16,
    fp32Tflops: gpu.fp32Tflops,
    fp64: gpu.fp64,
    displayConnectors: gpu.displayConnectors,
    g3dMarkPrice: gpu.g3dMarkPrice,
    overallRank: gpu.overallRank,
    lastPriceChangeUsd: gpu.lastPriceChangeUsd,
    lastPriceChangeDate: gpu.lastPriceChangeDate,
    g3dMark: gpu.g3dMark,
    g2dMark: gpu.g2dMark,
    samples: gpu.samples,
    directx9Frames: gpu.directx9Frames,
    directx10Frames: gpu.directx10Frames,
    directx11Frames: gpu.directx11Frames,
    directx12Frames: gpu.directx12Frames,
    gpuComputeOps: gpu.gpuComputeOps,
    source: gpu.source,
    verification: gpu.verification,
    scrapedAt: gpu.scrapedAt,
    category,
    categoryLabel: gpuCategoryLabel(category),
    llmBenchmark,
    llmOfficialTokens: llmBenchmark?.performanceResult ?? null,
  };
}

function attachGpuDerivedMetrics(items, llmData) {
  const normalized = items.map((gpu) => normalizeGpu(gpu, llmData));
  const rawMap = normalized.map((gpu) => calculateGpuLlmTheoreticalRaw(gpu));
  const maxRaw = Math.max(...rawMap.filter((value) => value != null), 0);

  return normalized.map((gpu, index) => ({
    ...gpu,
    llmTheoreticalRaw: rawMap[index],
    llmTheoreticalScore:
      rawMap[index] == null || maxRaw === 0 ? null : Number(((rawMap[index] / maxRaw) * 100).toFixed(1)),
    llmTheoreticalNote: "仅供参考，基于显存容量、显存带宽和 FP16/FP32 规格推导，非实测。",
  }));
}

function buildGpuComparePayload(gpus, llmData, options) {
  const normalized = attachGpuDerivedMetrics(gpus, llmData);
  return {
    inputs: {
      hoursPerDay: Number(options.hoursPerDay ?? 8),
      utilizationPercent: Number(options.utilizationPercent ?? 35),
      costPerKwh: Number(options.costPerKwh ?? 0.15),
    },
    gpus: normalized.map((gpu) => ({
      ...gpu,
      energyUsage: createEnergyEstimate(gpu.maxTdp, options),
    })),
  };
}

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "landing.html"));
});

app.get("/cpu", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/gpu", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "gpu.html"));
});

app.get("/api/meta", (_req, res) => {
  const verification = readJson(CPU_VERIFY_PATH, null);
  res.json({
    meta: readJson(CPU_META_PATH, null),
    verification: verification
      ? {
          generatedAt: verification.generatedAt,
          listCount: verification.listCount,
          detailCount: verification.detailCount,
          coverageComplete: verification.coverageComplete,
          missingDetailsCount: verification.missingDetails.length,
          incompleteCount: verification.incomplete.length,
        }
      : null,
  });
});

app.get("/api/cpus", (req, res) => {
  const cpus = readJson(CPU_PATH, []);
  const q = String(req.query.q || "").trim().toLowerCase();
  const cpuClass = String(req.query.cpuClass || "").trim().toLowerCase();
  const socketType = String(req.query.socketType || "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const filtered = cpus.filter((cpu) => {
    const matchesQuery =
      !q ||
      cpu.name.toLowerCase().includes(q) ||
      String(cpu.brand || "").toLowerCase().includes(q) ||
      String(cpu.cpuClass || "").toLowerCase().includes(q);
    const matchesClass = !cpuClass || String(cpu.cpuClass || "").toLowerCase().includes(cpuClass);
    const matchesSocket = !socketType || String(cpu.socketType || "").toLowerCase().includes(socketType);
    return matchesQuery && matchesClass && matchesSocket;
  });

  res.json({
    total: filtered.length,
    items: filtered
      .sort((a, b) => (b.cpuMark || 0) - (a.cpuMark || 0))
      .slice(0, limit)
      .map(normalizeCpu),
  });
});

app.get("/api/rankings", (req, res) => {
  const cpus = readJson(CPU_PATH, []);
  const metric = ["singleThreadRating", "cpuMark"].includes(String(req.query.metric)) ? String(req.query.metric) : "cpuMark";
  const limit = Math.min(Number(req.query.limit || 50), 200);
  res.json({ metric, items: sortByMetric(cpus, metric).slice(0, limit).map(normalizeCpu) });
});

app.get("/api/categories", (_req, res) => {
  const cpus = readJson(CPU_PATH, []);
  const grouped = cpus.reduce(
    (acc, cpu) => {
      const category = detectCpuCategory(cpu);
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    },
    { server: 0, desktop: 0, laptop: 0, other: 0 }
  );
  res.json({
    items: Object.entries(grouped).map(([key, count]) => ({ key, label: cpuCategoryLabel(key), count })),
  });
});

app.get("/api/categories/:category/rankings", (req, res) => {
  const category = String(req.params.category || "").toLowerCase();
  if (!["server", "desktop", "laptop", "other"].includes(category)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  const cpus = readJson(CPU_PATH, []).filter((cpu) => detectCpuCategory(cpu) === category);
  const metric = ["singleThreadRating", "cpuMark"].includes(String(req.query.metric)) ? String(req.query.metric) : "cpuMark";
  const limit = Math.min(Number(req.query.limit || 100), 200);
  res.json({
    category,
    categoryLabel: cpuCategoryLabel(category),
    metric,
    total: cpus.length,
    items: sortByMetric(cpus, metric).slice(0, limit).map(normalizeCpu),
  });
});

app.post("/api/compare", (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const cpus = readJson(CPU_PATH, []).filter((cpu) => ids.includes(String(cpu.id)));
  if (!cpus.length) {
    res.status(400).json({ error: "No CPUs selected" });
    return;
  }
  res.json(buildCpuComparePayload(cpus, req.body || {}));
});

app.get("/api/gpu/meta", (_req, res) => {
  const verification = readJson(GPU_VERIFY_PATH, null);
  const llm = readJson(GPU_LLM_PATH, null);
  res.json({
    meta: readJson(GPU_META_PATH, null),
    verification: verification
      ? {
          generatedAt: verification.generatedAt,
          listCount: verification.listCount,
          detailCount: verification.detailCount,
          coverageComplete: verification.coverageComplete,
          missingDetailsCount: verification.missingDetails.length,
          incompleteCount: verification.incomplete.length,
        }
      : null,
    llm: llm ? { source: llm.source, count: llm.items.length, benchmark: llm.benchmark, scenario: llm.scenario } : null,
  });
});

app.get("/api/gpu/gpus", (req, res) => {
  const gpus = readJson(GPU_PATH, []);
  const llm = readJson(GPU_LLM_PATH, null);
  const q = String(req.query.q || "").trim().toLowerCase();
  const gpuClass = String(req.query.gpuClass || "").trim().toLowerCase();
  const bus = String(req.query.bus || "").trim().toLowerCase();
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const filtered = gpus.filter((gpu) => {
    const matchesQuery =
      !q ||
      gpu.name.toLowerCase().includes(q) ||
      String(gpu.otherNames || "").toLowerCase().includes(q) ||
      String(gpu.videocardCategory || "").toLowerCase().includes(q);
    const matchesClass = !gpuClass || String(gpu.videocardCategory || "").toLowerCase().includes(gpuClass) || detectGpuCategory(gpu).includes(gpuClass);
    const matchesBus = !bus || String(gpu.busInterface || "").toLowerCase().includes(bus) || String(gpu.maxMemorySize || "").toLowerCase().includes(bus);
    return matchesQuery && matchesClass && matchesBus;
  });

  res.json({
    total: filtered.length,
    items: attachGpuDerivedMetrics(
      filtered
      .sort((a, b) => {
        const scoreDiff = gpuSearchScore(b, q) - gpuSearchScore(a, q);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.g3dMark || 0) - (a.g3dMark || 0);
      })
      .slice(0, limit),
      llm
    ),
  });
});

app.get("/api/gpu/rankings", (req, res) => {
  const gpus = readJson(GPU_PATH, []);
  const llm = readJson(GPU_LLM_PATH, null);
  const metric = ["g3dMark", "directx12Frames", "gpuComputeOps", "g2dMark", "llmTheoreticalScore", "llmOfficialTokens"].includes(String(req.query.metric))
    ? String(req.query.metric)
    : "g3dMark";
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const normalized = attachGpuDerivedMetrics(gpus, llm);
  const filtered = metric === "g3dMark" ? normalized : normalized.filter((gpu) => gpu[metric] != null);
  res.json({
    metric,
    items: sortByMetric(filtered, metric).slice(0, limit),
  });
});

app.get("/api/gpu/categories", (_req, res) => {
  const gpus = readJson(GPU_PATH, []);
  const grouped = gpus.reduce(
    (acc, gpu) => {
      const category = detectGpuCategory(gpu);
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    },
    { server: 0, workstation: 0, desktop: 0, laptop: 0, integrated: 0, other: 0 }
  );
  res.json({
    items: Object.entries(grouped).map(([key, count]) => ({ key, label: gpuCategoryLabel(key), count })),
  });
});

app.get("/api/gpu/categories/:category/rankings", (req, res) => {
  const category = String(req.params.category || "").toLowerCase();
  if (!["server", "workstation", "desktop", "laptop", "integrated", "other"].includes(category)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  const gpus = readJson(GPU_PATH, []).filter((gpu) => detectGpuCategory(gpu) === category);
  const llm = readJson(GPU_LLM_PATH, null);
  const metric = ["g3dMark", "directx12Frames", "gpuComputeOps", "g2dMark", "llmTheoreticalScore", "llmOfficialTokens"].includes(String(req.query.metric))
    ? String(req.query.metric)
    : "g3dMark";
  const limit = Math.min(Number(req.query.limit || 100), 200);
  const normalized = attachGpuDerivedMetrics(gpus, llm);
  const filtered = metric === "g3dMark" ? normalized : normalized.filter((gpu) => gpu[metric] != null);
  res.json({
    category,
    categoryLabel: gpuCategoryLabel(category),
    metric,
    total: gpus.length,
    items: sortByMetric(filtered, metric).slice(0, limit),
  });
});

app.post("/api/gpu/compare", (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const gpus = readJson(GPU_PATH, []).filter((gpu) => ids.includes(String(gpu.id)));
  const llm = readJson(GPU_LLM_PATH, null);
  if (!gpus.length) {
    res.status(400).json({ error: "No GPUs selected" });
    return;
  }
  res.json(buildGpuComparePayload(gpus, llm, req.body || {}));
});

app.use((_req, res) => {
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log(`硬件对比平台已启动: http://localhost:${PORT}`);
});
