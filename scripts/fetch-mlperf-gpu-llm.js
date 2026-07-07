const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const OUTPUT_PATH = path.join(DATA_DIR, "gpu-llm-benchmarks.json");
const SOURCE_URL = "https://raw.githubusercontent.com/mlcommons/inference_results_v6.0/main/summary_results.json";

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            resolve(JSON.parse(data));
          });
        }
      )
      .on("error", reject);
  });
}

function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\(x\d+\)/g, "")
    .replace(/\b\d+gb\b/g, "")
    .replace(/\b\d+g\b/g, "")
    .replace(/\b288gb hbm3e\b/g, "")
    .replace(/\bhbm\d\w*\b/g, "")
    .replace(/\bpcie\b/g, "pcie")
    .replace(/\bsxm\d?\b/g, "sxm")
    .replace(/\bblackwell\b/g, "blackwell")
    .replace(/\binstinct\b/g, "instinct")
    .replace(/\brtx pro\b/g, "rtx pro")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function acceleratorDisplayName(text) {
  return String(text || "").replace(/\s*\(x\d+\)\s*$/i, "").trim();
}

async function main() {
  const rows = await requestJson(SOURCE_URL);
  const filtered = rows.filter(
    (row) =>
      row.version === "v6.0" &&
      row.Model === "llama2-70b-99" &&
      row.Scenario === "Offline" &&
      row.Performance_Result != null &&
      row.Accelerator
  );

  const grouped = new Map();
  for (const row of filtered) {
    const acceleratorName = acceleratorDisplayName(row.Accelerator);
    const key = normalizeName(acceleratorName);
    const existing = grouped.get(key);
    if (!existing || Number(row.Performance_Result) > Number(existing.performanceResult)) {
      grouped.set(key, {
        key,
        acceleratorName,
        model: row.Model,
        scenario: row.Scenario,
        performanceResult: Number(row.Performance_Result),
        performanceUnits: row.Performance_Units,
        totalAccelerators: Number(row["Total Accelerators"] || 0),
        system: row.System,
        submitter: row.Submitter,
        details: row.Details,
        version: row.version,
      });
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: "MLPerf Inference v6.0",
    sourceUrl: SOURCE_URL,
    benchmark: "llama2-70b-99",
    scenario: "Offline",
    items: [...grouped.values()].sort((a, b) => b.performanceResult - a.performanceResult),
  };

  writeJson(OUTPUT_PATH, output);
  console.log(JSON.stringify({ count: output.items.length, top: output.items.slice(0, 10) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
