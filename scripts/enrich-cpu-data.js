const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CPU_PATH = path.join(DATA_DIR, "cpus.json");
const META_PATH = path.join(DATA_DIR, "meta.json");
const CACHE_DIR = path.join(DATA_DIR, "source-cache");
const CPU7_DIR = path.join(CACHE_DIR, "cpu7");
const MONKEY_DIR = path.join(CACHE_DIR, "cpu-monkey");
const XINCANSHU_DIR = path.join(CACHE_DIR, "xincanshu");
const CONCURRENCY = Number(process.env.ENRICH_CONCURRENCY || 8);
const LIMIT = Number(process.env.ENRICH_LIMIT || 0);

const MANUAL_OVERRIDES = {
  "4859": {
    cache: "L3 Cache: 192 MB",
    tdp: "240 W",
    source: "Manual cross-check: xincanshu AMD EPYC 7K62 + Kryptex power listing",
  },
};

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

function requestText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCached(url, file) {
  if (fs.existsSync(file)) {
    return { status: 200, body: fs.readFileSync(file, "utf8"), cached: true };
  }
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await requestText(url);
      if (result.status === 200 && result.body) {
        fs.writeFileSync(file, result.body, "utf8");
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

function toNumber(text) {
  if (text == null) {
    return null;
  }
  const cleaned = String(text).replace(/[^0-9.]/g, "");
  if (!cleaned) {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function mergeField(cpu, key, value, source, force = false) {
  if (value == null || value === "" || value === "NA") {
    return false;
  }
  if (!force && cpu[key] != null && cpu[key] !== "") {
    return false;
  }
  cpu[key] = value;
  cpu.enrichment = cpu.enrichment || { sources: [] };
  cpu.enrichment.sources.push({
    field: key,
    source,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

function mapCpu7Class(value) {
  if (!value) {
    return null;
  }
  if (value.includes("服务器")) {
    return "Server";
  }
  if (value.includes("台式")) {
    return "Desktop";
  }
  if (value.includes("笔记本")) {
    return "Laptop";
  }
  if (value.includes("移动")) {
    return "Mobile/Embedded";
  }
  return null;
}

function mapMonkeySegment(value) {
  if (!value) {
    return null;
  }
  const lowered = value.toLowerCase();
  if (lowered.includes("server")) return "Server";
  if (lowered.includes("desktop")) return "Desktop";
  if (lowered.includes("notebook") || lowered.includes("laptop")) return "Laptop";
  if (lowered.includes("mobile") || lowered.includes("embedded")) return "Mobile/Embedded";
  return value;
}

function inferClassFromName(name) {
  const value = String(name || "").toLowerCase();
  if (/(epyc|xeon|opteron|threadripper pro)/.test(value)) {
    return "Server";
  }
  if (/(athlon|phenom|sempron|ryzen|threadripper|core i|core ultra|pentium|celeron|fx-)/.test(value)) {
    return "Desktop";
  }
  if (/(mobile|notebook|\bmx\b|\bu\b|\bhq\b|\bhk\b|\bhx\b|\bhs\b|\by\b)/.test(value)) {
    return "Laptop";
  }
  return null;
}

function fixFromRawText(cpu) {
  let changed = 0;
  const raw = String(cpu.rawText || "");

  if ((!cpu.physicalCores || !cpu.physicalCoresText) && raw) {
    const moduleMatch = raw.match(/Cores:\s*(\d+)\s*\(in\s*(\d+)\s*physical modules\)/i);
    if (moduleMatch) {
      const logicalCores = Number(moduleMatch[1]);
      const physicalModules = Number(moduleMatch[2]);
      const threads = cpu.threads || logicalCores;
      if (mergeField(cpu, "physicalCores", physicalModules, "PassMark raw text")) changed += 1;
      if (mergeField(cpu, "threads", threads, "PassMark raw text")) changed += 1;
      if (
        mergeField(
          cpu,
          "physicalCoresText",
          `${physicalModules} (Threads: ${threads}, Modules/Cores reported: ${logicalCores})`,
          "PassMark raw text"
        )
      ) {
        changed += 1;
      }
    }
  }

  if (!cpu.cpuClass) {
    const inferredClass = inferClassFromName(cpu.name);
    if (mergeField(cpu, "cpuClass", inferredClass, "Name heuristic")) changed += 1;
  }

  return changed;
}

function cpuMonkeySlug(name) {
  return String(name || "")
    .replace(/\s*@\s*[\d.]+\s*GHz/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\+/g, " plus ")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function xincanshuSlug(name) {
  return String(name || "")
    .replace(/\s*@\s*[\d.]+\s*GHz/gi, "")
    .replace(/\(.*?\)/g, "")
    .replace(/®|™/g, "")
    .replace(/\+/g, "plus")
    .replace(/[-/\s]+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseCpu7(cpu, html) {
  let changed = 0;
  const cleaned = normalizeText(html);
  const classMatch = cleaned.match(/类型:\s*([^\n]+)/);
  const socketMatch = cleaned.match(/插槽:\s*([^\n]+)/);
  const clockMatch = cleaned.match(/时钟频率:\s*([^\n]+)/);
  const turboMatch = cleaned.match(/睿频:\s*([^\n]+)/);
  const coreMatch = cleaned.match(/核心数量:\s*总核心数量\s*(\d+)\s*\((\d+)\s*个物理核心\)/);
  const tdpMatch = cleaned.match(/典型TDP:\s*([^\n]+)/);
  const singleMatch = cleaned.match(/单核性能:\s*([0-9.]+)/);

  if (mergeField(cpu, "cpuClass", mapCpu7Class(classMatch?.[1]), "CPU7")) changed += 1;
  if (mergeField(cpu, "socketType", socketMatch?.[1]?.trim(), "CPU7")) changed += 1;
  if (mergeField(cpu, "clockspeed", clockMatch?.[1]?.trim(), "CPU7")) changed += 1;

  const turboValue = turboMatch?.[1]?.trim();
  if (turboValue && turboValue !== "0 GHz") {
    if (mergeField(cpu, "turboSpeed", turboValue, "CPU7")) changed += 1;
  } else if (turboValue === "0 GHz" && mergeField(cpu, "turboSpeed", "不支持", "CPU7")) {
    changed += 1;
  }

  if (coreMatch) {
    const totalThreads = Number(coreMatch[1]);
    const physicalCores = Number(coreMatch[2]);
    if (mergeField(cpu, "physicalCores", physicalCores, "CPU7")) changed += 1;
    if (mergeField(cpu, "threads", totalThreads, "CPU7")) changed += 1;
    if (mergeField(cpu, "physicalCoresText", `${physicalCores} (Threads: ${totalThreads})`, "CPU7")) changed += 1;
  }

  const tdpValue = tdpMatch?.[1]?.trim();
  if (tdpValue && tdpValue !== "0 W") {
    if (mergeField(cpu, "tdp", tdpValue, "CPU7")) changed += 1;
  }

  if (singleMatch && mergeField(cpu, "singleThreadRating", toNumber(singleMatch[1]), "CPU7")) {
    changed += 1;
  }

  return changed;
}

function extractMonkeyValue(text, label) {
  const pattern = new RegExp(`${label}\\s*([^\\n]+)`, "i");
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

function parseCpuMonkey(cpu, html) {
  let changed = 0;
  const cleaned = normalizeText(html);

  const segment = extractMonkeyValue(cleaned, "Segment");
  const socket = extractMonkeyValue(cleaned, "Socket");
  const coresThreads = extractMonkeyValue(cleaned, "CPU Cores / Threads");
  const frequency = extractMonkeyValue(cleaned, "Frequency:");
  const turbo1 = extractMonkeyValue(cleaned, "Turbo Frequency \\(1 Core\\):");
  const l2 = extractMonkeyValue(cleaned, "L2-Cache");
  const l3 = extractMonkeyValue(cleaned, "L3-Cache");
  const tdp = extractMonkeyValue(cleaned, "TDP");

  if (mergeField(cpu, "cpuClass", mapMonkeySegment(segment), "CPU-Monkey")) changed += 1;
  if (mergeField(cpu, "socketType", socket, "CPU-Monkey")) changed += 1;
  if (mergeField(cpu, "clockspeed", frequency, "CPU-Monkey")) changed += 1;

  if (turbo1) {
    if (mergeField(cpu, "turboSpeed", turbo1, "CPU-Monkey")) changed += 1;
  } else if (mergeField(cpu, "turboSpeed", "不支持", "CPU-Monkey")) {
    changed += 1;
  }

  if (coresThreads) {
    const match = coresThreads.match(/(\d+)\s*\/\s*(\d+)/);
    if (match) {
      const cores = Number(match[1]);
      const threads = Number(match[2]);
      if (mergeField(cpu, "physicalCores", cores, "CPU-Monkey")) changed += 1;
      if (mergeField(cpu, "threads", threads, "CPU-Monkey")) changed += 1;
      if (mergeField(cpu, "physicalCoresText", `${cores} (Threads: ${threads})`, "CPU-Monkey")) changed += 1;
    }
  }

  const cacheLines = [];
  if (l2) cacheLines.push(`L2 Cache: ${l2}`);
  if (l3) cacheLines.push(`L3 Cache: ${l3}`);
  if (cacheLines.length && mergeField(cpu, "cache", cacheLines.join("\n"), "CPU-Monkey")) {
    changed += 1;
  }

  if (tdp && mergeField(cpu, "tdp", tdp, "CPU-Monkey")) {
    changed += 1;
  }

  return changed;
}

function extractMetaDescription(html) {
  return html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || "";
}

function extractChineseValue(text, label) {
  const match = text.match(new RegExp(`${label}\\s*[:：]?\\s*([^\\n]+)`));
  return match ? match[1].trim() : null;
}

function normalizeTdp(value) {
  if (!value) {
    return null;
  }
  const number = toNumber(value);
  return number ? `${number} W` : null;
}

function parseXincanshu(cpu, html) {
  let changed = 0;
  if (/内容找不到了/.test(html)) {
    return changed;
  }

  const description = extractMetaDescription(html);
  const cleaned = normalizeText(html);
  const scope = `${description}\n${cleaned}`;

  const clock = description.match(/基础频率\s*([0-9.]+\s*GHz)/)?.[1];
  const turbo = description.match(/单核睿频可达\s*([0-9.]+\s*GHz)/)?.[1];
  const coreThread = description.match(/(\d+)\s*核\s*(\d+)\s*线程/);
  const socket = description.match(/使用\s*([A-Za-z0-9+_/-]+)\s*接口/)?.[1];
  const tdp = description.match(/TDP功耗\s*([0-9.]+\s*W?)/)?.[1];
  const l1 = extractChineseValue(scope, "一级缓存");
  const l2 = extractChineseValue(scope, "二级缓存");
  const l3 = extractChineseValue(scope, "三级缓存");

  if (mergeField(cpu, "clockspeed", clock, "芯参数")) changed += 1;
  if (mergeField(cpu, "turboSpeed", turbo, "芯参数")) changed += 1;
  if (mergeField(cpu, "socketType", socket, "芯参数")) changed += 1;
  if (mergeField(cpu, "tdp", normalizeTdp(tdp), "芯参数")) changed += 1;

  if (coreThread) {
    const cores = Number(coreThread[1]);
    const threads = Number(coreThread[2]);
    if (mergeField(cpu, "physicalCores", cores, "芯参数")) changed += 1;
    if (mergeField(cpu, "threads", threads, "芯参数")) changed += 1;
    if (mergeField(cpu, "physicalCoresText", `${cores} (Threads: ${threads})`, "芯参数")) changed += 1;
  }

  const cacheLines = [];
  if (l1) cacheLines.push(`L1 Cache: ${l1}`);
  if (l2) cacheLines.push(`L2 Cache: ${l2}`);
  if (l3) cacheLines.push(`L3 Cache: ${l3}`);
  if (cacheLines.length && mergeField(cpu, "cache", cacheLines.join("\n"), "芯参数")) {
    changed += 1;
  }

  return changed;
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

function hasMissing(cpu) {
  return (
    !cpu.turboSpeed ||
    !cpu.socketType ||
    !cpu.cache ||
    !cpu.tdp ||
    !cpu.clockspeed ||
    !cpu.cpuClass ||
    !cpu.physicalCores ||
    !cpu.singleThreadRating
  );
}

async function enrichCpu(cpu) {
  let changed = 0;
  changed += fixFromRawText(cpu);

  const cpu7Cache = path.join(CPU7_DIR, `${cpu.id}.html`);
  const cpu7Result = await fetchCached(`https://www.cpu7.com/cpu/detail/${cpu.id}`, cpu7Cache);
  if (cpu7Result.status === 200 && cpu7Result.body) {
    changed += parseCpu7(cpu, cpu7Result.body);
  }

  const monkeySlug = cpuMonkeySlug(cpu.name);
  const monkeyCache = path.join(MONKEY_DIR, `${monkeySlug}.html`);
  const monkeyResult = await fetchCached(`https://www.cpu-monkey.com/en/cpu-${monkeySlug}`, monkeyCache);
  if (monkeyResult.status === 200 && monkeyResult.body.includes("Specifications")) {
    changed += parseCpuMonkey(cpu, monkeyResult.body);
  }

  const xSlug = xincanshuSlug(cpu.name);
  const xCache = path.join(XINCANSHU_DIR, `${xSlug}.html`);
  const xResult = await fetchCached(`https://www.xincanshu.com/cpu/${xSlug}/canshu.html`, xCache);
  if (xResult.status === 200 && xResult.body) {
    changed += parseXincanshu(cpu, xResult.body);
  }

  const override = MANUAL_OVERRIDES[String(cpu.id)];
  if (override) {
    if (mergeField(cpu, "cache", override.cache, override.source)) changed += 1;
    if (mergeField(cpu, "tdp", override.tdp, override.source)) changed += 1;
  }

  return changed;
}

async function main() {
  ensureDir(CPU7_DIR);
  ensureDir(MONKEY_DIR);
  ensureDir(XINCANSHU_DIR);

  const cpus = readJson(CPU_PATH, []);
  const targets = cpus.filter(hasMissing);
  const list = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  let changedCount = 0;

  console.log(`Need enrichment: ${list.length}`);

  await runPool(
    list,
    async (cpu) => {
      try {
        const changed = await enrichCpu(cpu);
        if (changed > 0) {
          changedCount += 1;
        }
      } catch (error) {
        console.error(`Enrichment failed for ${cpu.id} ${cpu.name}: ${error.message}`);
      }
    },
    CONCURRENCY
  );

  writeJson(CPU_PATH, cpus);

  const meta = readJson(META_PATH, {});
  meta.enrichment = {
    updatedAt: new Date().toISOString(),
    changedCpuRecords: changedCount,
    attemptedCpuRecords: list.length,
    sources: ["CPU7", "CPU-Monkey", "芯参数", "PassMark raw text", "Manual overrides"],
  };
  writeJson(META_PATH, meta);

  console.log(JSON.stringify(meta.enrichment, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
