const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CPU_PATH = path.join(DATA_DIR, "cpus.json");
const LIST_PATH = path.join(DATA_DIR, "passmark-list.json");
const REPORT_PATH = path.join(DATA_DIR, "verification-report.json");

function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const list = readJson(LIST_PATH, []);
const cpus = readJson(CPU_PATH, []);
const cpuMap = new Map(cpus.map((cpu) => [String(cpu.id), cpu]));

function computeMissingFields(cpu) {
  return [
    ["socketType", cpu.socketType],
    ["cpuClass", cpu.cpuClass],
    ["clockspeed", cpu.clockspeed],
    ["turboSpeed", cpu.turboSpeed],
    ["physicalCores", cpu.physicalCores],
    ["cache", cpu.cache],
    ["tdp", cpu.tdp],
    ["firstSeenOnChart", cpu.firstSeenOnChart],
    ["cpuRank", cpu.cpuRank],
    ["cpuMark", cpu.cpuMark],
    ["singleThreadRating", cpu.singleThreadRating],
  ]
    .filter(([, value]) => value == null || value === "")
    .map(([field]) => field);
}

const missingDetails = list.filter((item) => !cpuMap.has(String(item.id))).map((item) => ({
  id: item.id,
  name: item.name,
}));

const mismatchedCpuMark = cpus
  .filter((cpu) => cpu.verification && cpu.verification.listVsDetailCpuMarkMatch === false)
  .map((cpu) => ({
    id: cpu.id,
    name: cpu.name,
    listCpuMark: cpu.listCpuMark,
    detailCpuMark: cpu.cpuMark,
  }));

const mismatchedCpuRank = cpus
  .filter((cpu) => cpu.verification && cpu.verification.listVsDetailCpuRankMatch === false)
  .map((cpu) => ({
    id: cpu.id,
    name: cpu.name,
    listCpuRank: cpu.listCpuRank,
    detailCpuRank: cpu.cpuRank,
  }));

const incomplete = cpus
  .map((cpu) => ({
    id: cpu.id,
    name: cpu.name,
    missingFields: computeMissingFields(cpu),
  }))
  .filter((cpu) => cpu.missingFields.length > 0)
  .map((cpu) => ({
    id: cpu.id,
    name: cpu.name,
    missingFields: cpu.missingFields,
  }));

const report = {
  generatedAt: new Date().toISOString(),
  listCount: list.length,
  detailCount: cpus.length,
  coverageComplete: missingDetails.length === 0 && list.length === cpus.length,
  missingDetails,
  mismatchedCpuMark,
  mismatchedCpuRank,
  incomplete,
};

fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
