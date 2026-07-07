const DEFAULT_STATE = {
  tab: "compare",
  compareView: "builder",
  q: "",
  gpuClass: "",
  bus: "",
  selected: [],
  graphicsRankingLimit: "50",
  llmRankingLimit: "50",
  hours: "8",
  util: "35",
  cost: "0.15",
};

const state = {
  ...DEFAULT_STATE,
  gpuLookup: new Map(),
};

const els = {
  metaTotal: document.getElementById("meta-total"),
  metaGenerated: document.getElementById("meta-generated"),
  metaVerification: document.getElementById("meta-verification"),
  searchInput: document.getElementById("search-input"),
  classInput: document.getElementById("class-input"),
  busInput: document.getElementById("bus-input"),
  searchResults: document.getElementById("search-results"),
  selectedGpus: document.getElementById("selected-gpus"),
  clearSelection: document.getElementById("clear-selection"),
  hoursInput: document.getElementById("hours-input"),
  utilInput: document.getElementById("util-input"),
  costInput: document.getElementById("cost-input"),
  compareButton: document.getElementById("compare-button"),
  compareEmpty: document.getElementById("compare-empty"),
  compareContent: document.getElementById("compare-content"),
  compareSummary: document.getElementById("compare-summary"),
  compareTable: document.getElementById("compare-table"),
  g3dChart: document.getElementById("g3d-chart"),
  llmChart: document.getElementById("llm-chart"),
  llmTheoreticalChart: document.getElementById("llm-theoretical-chart"),
  graphicsRankingLimit: document.getElementById("graphics-ranking-limit"),
  llmRankingLimit: document.getElementById("llm-ranking-limit"),
  rankingGameList: document.getElementById("ranking-game-list"),
  rankingLlmList: document.getElementById("ranking-llm-list"),
  addMoreButton: document.getElementById("add-more-button"),
  refreshCompareButton: document.getElementById("refresh-compare-button"),
  jumpToResults: document.getElementById("jump-to-results"),
  compareResults: document.getElementById("compare-results"),
  tabButtons: [...document.querySelectorAll(".tab-button")],
  tabPanels: [...document.querySelectorAll(".tab-panel")],
};

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) return "NA";
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDateTime(value) {
  if (!value) return "未知";
  return new Date(value).toLocaleString("zh-CN");
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) return "NA";
  return `$${value.toFixed(2)}`;
}

function parseNumericValue(value) {
  if (value == null) return null;
  const match = String(value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) ? num : null;
}

function parseMemorySizeGb(value) {
  const num = parseNumericValue(value);
  if (num == null) return null;
  const text = String(value).toUpperCase();
  if (text.includes("TB")) return num * 1024;
  if (text.includes("MB")) return num / 1024;
  return num;
}

function formatMemorySize(value) {
  const sizeGb = parseMemorySizeGb(value);
  if (sizeGb == null) return value || "NA";
  const rounded = sizeGb >= 100 || Number.isInteger(sizeGb) ? sizeGb.toFixed(0) : sizeGb.toFixed(1);
  return `${rounded} GB`;
}

function parseBandwidthGbps(value) {
  const num = parseNumericValue(value);
  if (num == null) return null;
  const text = String(value).toUpperCase();
  if (text.includes("TB/S")) return num * 1000;
  if (text.includes("MB/S")) return num / 1000;
  return num;
}

function formatMemoryBandwidth(value) {
  const bandwidth = parseBandwidthGbps(value);
  if (bandwidth == null) return value || "NA";
  return `${bandwidth >= 1000 ? bandwidth.toFixed(0) : bandwidth.toFixed(1)} GB/s`;
}

function fetchJson(url, options) {
  return fetch(url, options).then((response) => {
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return response.json();
  });
}

function metricLabel(metric) {
  if (metric === "llmTheoreticalScore") return "理论 LLM 参考分";
  return "综合图形分";
}

function formatMetricValue(gpu, metric) {
  return formatNumber(gpu[metric]);
}

function urlFromState() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.gpuClass) params.set("class", state.gpuClass);
  if (state.bus) params.set("bus", state.bus);
  if (state.selected.length) params.set("selected", state.selected.join(","));
  if (state.compareView !== DEFAULT_STATE.compareView) params.set("compareView", state.compareView);
  if (state.graphicsRankingLimit !== DEFAULT_STATE.graphicsRankingLimit) {
    params.set("graphicsRankingLimit", state.graphicsRankingLimit);
  }
  if (state.llmRankingLimit !== DEFAULT_STATE.llmRankingLimit) {
    params.set("llmRankingLimit", state.llmRankingLimit);
  }
  if (state.hours !== DEFAULT_STATE.hours) params.set("hours", state.hours);
  if (state.util !== DEFAULT_STATE.util) params.set("util", state.util);
  if (state.cost !== DEFAULT_STATE.cost) params.set("cost", state.cost);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}#${state.tab}`;
}

function syncUrl(mode = "replace") {
  const nextUrl = urlFromState();
  if (mode === "push") {
    window.history.pushState({}, "", nextUrl);
  } else {
    window.history.replaceState({}, "", nextUrl);
  }
}

function applyStateToControls() {
  els.searchInput.value = state.q;
  els.classInput.value = state.gpuClass;
  els.busInput.value = state.bus;
  els.graphicsRankingLimit.value = state.graphicsRankingLimit;
  els.llmRankingLimit.value = state.llmRankingLimit;
  els.hoursInput.value = state.hours;
  els.utilInput.value = state.util;
  els.costInput.value = state.cost;
}

function hydrateStateFromUrl() {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  state.tab = (url.hash || "#compare").replace("#", "") || DEFAULT_STATE.tab;
  if (!["compare", "graphics", "llm"].includes(state.tab)) state.tab = DEFAULT_STATE.tab;
  state.compareView = params.get("compareView") || DEFAULT_STATE.compareView;
  if (!["builder", "results"].includes(state.compareView)) state.compareView = DEFAULT_STATE.compareView;
  state.q = params.get("q") || DEFAULT_STATE.q;
  state.gpuClass = params.get("class") || DEFAULT_STATE.gpuClass;
  state.bus = params.get("bus") || DEFAULT_STATE.bus;
  state.selected = (params.get("selected") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  state.graphicsRankingLimit = params.get("graphicsRankingLimit") || DEFAULT_STATE.graphicsRankingLimit;
  state.llmRankingLimit = params.get("llmRankingLimit") || DEFAULT_STATE.llmRankingLimit;
  state.hours = params.get("hours") || DEFAULT_STATE.hours;
  state.util = params.get("util") || DEFAULT_STATE.util;
  state.cost = params.get("cost") || DEFAULT_STATE.cost;
  applyStateToControls();
}

function switchTab(nextTab, historyMode = "push") {
  state.tab = nextTab;
  els.tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === nextTab));
  els.tabPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === nextTab));
  syncUrl(historyMode);
}

function createActionButton(gpuId) {
  const selected = state.selected.includes(String(gpuId));
  return `
    <button class="pick-button" data-pick="${gpuId}" ${selected ? "disabled" : ""} type="button">
      ${selected ? "已加入对比" : "加入对比"}
    </button>
  `;
}

function gpuRowTemplate(gpu, options = {}) {
  const rank = options.rank ? `<div class="cpu-rank">${options.rank}</div>` : `<div class="cpu-rank">#</div>`;
  const compactClass = options.compact ? "compact" : "";
  const metric = options.metric || "g3dMark";
  const metrics = options.compact
    ? `
      <div class="cpu-metric"><span>${metricLabel(metric)}</span><strong>${formatMetricValue(gpu, metric)}</strong></div>
      <div class="cpu-metric"><span>分类</span><strong>${gpu.categoryLabel || "未分类"}</strong></div>
      <div class="cpu-metric"><span>显存</span><strong>${formatMemorySize(gpu.maxMemorySize)}</strong></div>
      <div class="cpu-metric"><span>功耗</span><strong>${gpu.maxTdp || "NA"}</strong></div>
      <div class="cpu-actions">${createActionButton(gpu.id)}</div>
    `
    : `
      <div class="cpu-metric"><span>综合图形分</span><strong>${formatNumber(gpu.g3dMark)}</strong></div>
      <div class="cpu-metric"><span>理论 LLM 参考分</span><strong>${formatNumber(gpu.llmTheoreticalScore)}</strong></div>
      <div class="cpu-metric"><span>分类</span><strong>${gpu.categoryLabel || "未分类"}</strong></div>
      <div class="cpu-metric"><span>显存</span><strong>${formatMemorySize(gpu.maxMemorySize)}${gpu.memoryType ? ` · ${gpu.memoryType}` : ""}</strong></div>
      <div class="cpu-metric"><span>功耗</span><strong>${gpu.maxTdp || "NA"}</strong></div>
      <div class="cpu-actions">${createActionButton(gpu.id)}</div>
    `;

  return `
    <article class="cpu-row ${compactClass}">
      ${rank}
      <div class="cpu-main">
        <strong>${gpu.name}</strong>
        <div class="cpu-sub">
          ${gpu.videocardCategory || "未标注类别"} · ${gpu.busInterface || "接口未标注"} · 首次收录 ${gpu.firstBenchmarked || "未知"}
        </div>
      </div>
      ${metrics}
    </article>
  `;
}

function renderSelected() {
  els.selectedGpus.innerHTML = "";
  if (!state.selected.length) {
    els.selectedGpus.innerHTML = `<span class="cpu-sub">尚未选择 GPU</span>`;
    return;
  }
  state.selected.forEach((id) => {
    const gpu = state.gpuLookup.get(String(id));
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${gpu ? gpu.name : `GPU #${id}`}</span><button type="button" data-remove="${id}">×</button>`;
    els.selectedGpus.appendChild(chip);
  });
}

function renderBarChart(el, items, labelKey, valueKey, emptyText) {
  const available = items.filter((item) => item[valueKey] != null);
  if (!available.length) {
    el.innerHTML = `<div class="empty-state">${emptyText}</div>`;
    return;
  }
  const max = Math.max(...available.map((item) => item[valueKey] || 0), 1);
  el.innerHTML = available
    .map((item) => {
      const width = ((item[valueKey] || 0) / max) * 100;
      return `
        <div class="bar-row">
          <div class="bar-label">${item[labelKey]}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <div class="bar-value">${formatNumber(item[valueKey])}</div>
        </div>
      `;
    })
    .join("");
}

function renderCompareSummary(compareData) {
  const bestG3d = [...compareData.gpus].sort((a, b) => (b.g3dMark || 0) - (a.g3dMark || 0))[0];
  const bestLlm = [...compareData.gpus]
    .filter((gpu) => gpu.llmBenchmark?.performanceResult != null)
    .sort((a, b) => b.llmBenchmark.performanceResult - a.llmBenchmark.performanceResult)[0];
  const bestLlmTheory = [...compareData.gpus]
    .filter((gpu) => gpu.llmTheoreticalScore != null)
    .sort((a, b) => b.llmTheoreticalScore - a.llmTheoreticalScore)[0];
  const largestMemory = [...compareData.gpus]
    .filter((gpu) => parseMemorySizeGb(gpu.maxMemorySize) != null)
    .sort((a, b) => (parseMemorySizeGb(b.maxMemorySize) || 0) - (parseMemorySizeGb(a.maxMemorySize) || 0))[0];

  els.compareSummary.innerHTML = `
    <div class="compare-summary-card">
      <span>综合图形分领先</span>
      <strong>${bestG3d ? bestG3d.name : "NA"}</strong>
    </div>
    <div class="compare-summary-card">
      <span>显存规模领先</span>
      <strong>${largestMemory ? `${largestMemory.name} · ${formatMemorySize(largestMemory.maxMemorySize)}` : "NA"}</strong>
    </div>
    <div class="compare-summary-card">
      <span>LLM 官方公开结果领先</span>
      <strong>${
        bestLlm
          ? `${bestLlm.name} · ${formatNumber(bestLlm.llmBenchmark.performanceResult)} ${bestLlm.llmBenchmark.performanceUnits}`
          : "暂无公开结果"
      }</strong>
    </div>
    <div class="compare-summary-card">
      <span>理论 LLM 参考分领先</span>
      <strong>${bestLlmTheory ? `${bestLlmTheory.name} · ${formatNumber(bestLlmTheory.llmTheoreticalScore)}` : "暂无可计算值"}</strong>
    </div>
  `;
}

function renderCompareTable(compareData) {
  const rows = [
    ["总线接口", "busInterface"],
    ["显存类型", "memoryType"],
    ["最大显存", "maxMemorySize"],
    ["显存位宽", "memoryBusWidth"],
    ["核心频率", "coreClock"],
    ["加速频率", "boostClock"],
    ["显存频率", "memoryClock"],
    ["显存带宽", "memoryBandwidth"],
    ["架构", "architecture"],
    ["核心代号", "gpuCodeName"],
    ["制造工艺", "manufacturingProcess"],
    ["晶体管数量", "transistors"],
    ["OpenCL", "openCL"],
    ["Vulkan", "vulkan"],
    ["CUDA", "cuda"],
    ["Shader Model", "shaderModel"],
    ["最大功耗", "maxTdp"],
    ["显卡类别", "videocardCategory"],
    ["Tensor Cores", "tensorCores"],
    ["RT Cores", "rtCores"],
    ["FP16 理论算力", "fp16"],
    ["FP32 理论算力", "fp32Tflops"],
    ["FP64 理论算力", "fp64"],
    ["显示输出", "displayConnectors"],
    ["发布日期", "releaseDate"],
    ["首次收录时间", "firstBenchmarked"],
    ["总排名", "overallRank"],
    ["综合图形分", "g3dMark"],
    ["样本数量", "samples"],
    ["预估年耗电成本", "energyYear"],
    ["LLM 推理公开结果", "llmBenchmark"],
    ["理论 LLM 推理参考分", "llmTheoreticalScore"],
  ];

  const header = `
    <thead>
      <tr>
        <th>字段</th>
        ${compareData.gpus.map((gpu) => `<th>${gpu.name}</th>`).join("")}
      </tr>
    </thead>
  `;

  const body = rows
    .map(([label, key]) => {
      const cells = compareData.gpus
        .map((gpu) => {
          let value = gpu[key];
          if (key === "maxMemorySize") value = formatMemorySize(value);
          if (key === "memoryBandwidth") value = formatMemoryBandwidth(value);
          if (key === "energyYear") value = formatCurrency(gpu.energyUsage?.runningCostPerYear);
          if (key === "llmBenchmark") {
            value = gpu.llmBenchmark
              ? `${formatNumber(gpu.llmBenchmark.performanceResult)} ${gpu.llmBenchmark.performanceUnits}<br>${gpu.llmBenchmark.system}<br>${gpu.llmBenchmark.totalAccelerators} 卡系统`
              : "暂无官方公开结果";
          }
          if (key === "llmTheoreticalScore") {
            value =
              gpu.llmTheoreticalScore != null
                ? `${formatNumber(gpu.llmTheoreticalScore)}<br>${gpu.llmTheoreticalNote || ""}`
                : "暂无可计算值";
          }
          if (["overallRank", "g3dMark", "samples"].includes(key)) {
            value = formatNumber(value);
          }
          return `<td>${value ?? "NA"}</td>`;
        })
        .join("");
      return `<tr><th>${label}</th>${cells}</tr>`;
    })
    .join("");

  els.compareTable.innerHTML = `${header}<tbody>${body}</tbody>`;
}

async function runSearch() {
  const data = await fetchJson(
    `/api/gpu/gpus?q=${encodeURIComponent(state.q)}&gpuClass=${encodeURIComponent(state.gpuClass)}&bus=${encodeURIComponent(state.bus)}&limit=80`
  );
  data.items.forEach((gpu) => state.gpuLookup.set(String(gpu.id), gpu));
  els.searchResults.innerHTML = data.items.length
    ? data.items.map((gpu, index) => gpuRowTemplate(gpu, { rank: index + 1 })).join("")
    : `<div class="empty-state">没有找到符合条件的 GPU，请调整关键词或筛选条件。</div>`;
}

async function renderCompare(options = {}) {
  if (!state.selected.length) {
    window.alert("请先选择至少一款 GPU。");
    return;
  }

  state.hours = els.hoursInput.value;
  state.util = els.utilInput.value;
  state.cost = els.costInput.value;
  state.compareView = "results";
  syncUrl(options.historyMode || "push");

  const compareData = await fetchJson("/api/gpu/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids: state.selected,
      hoursPerDay: Number(state.hours),
      utilizationPercent: Number(state.util),
      costPerKwh: Number(state.cost),
    }),
  });

  compareData.gpus.forEach((gpu) => state.gpuLookup.set(String(gpu.id), gpu));
  els.compareEmpty.classList.add("hidden");
  els.compareContent.classList.remove("hidden");
  renderCompareSummary(compareData);
  renderBarChart(els.g3dChart, compareData.gpus, "name", "g3dMark", "当前所选 GPU 没有可用于绘图的综合图形分。");
  renderBarChart(
    els.llmChart,
    compareData.gpus
      .filter((gpu) => gpu.llmBenchmark)
      .map((gpu) => ({
        name: `${gpu.name} · ${gpu.llmBenchmark.totalAccelerators} 卡系统`,
        llmValue: gpu.llmBenchmark.performanceResult,
      })),
    "name",
    "llmValue",
    "当前所选 GPU 没有公开的 LLM 官方推理结果。"
  );
  renderBarChart(
    els.llmTheoreticalChart,
    compareData.gpus,
    "name",
    "llmTheoreticalScore",
    "当前所选 GPU 缺少足够的规格信息，无法计算理论 LLM 参考分。"
  );
  renderCompareTable(compareData);
  renderSelected();

  if (options.scroll !== false) {
    els.compareResults.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadMeta() {
  const data = await fetchJson("/api/gpu/meta");
  els.metaTotal.textContent = data.meta ? `${formatNumber(data.meta.detailRecordsStored)} 款 GPU` : "未生成";
  els.metaGenerated.textContent = data.meta ? formatDateTime(data.meta.generatedAt) : "未生成";
  els.metaVerification.textContent = data.llm ? `${data.llm.source} · ${formatNumber(data.llm.count)} 条` : "未生成";
}

async function loadGraphicsRanking() {
  const data = await fetchJson(`/api/gpu/rankings?metric=g3dMark&limit=${state.graphicsRankingLimit}`);
  data.items.forEach((gpu) => state.gpuLookup.set(String(gpu.id), gpu));
  els.rankingGameList.innerHTML = data.items.length
    ? data.items.map((gpu, index) => gpuRowTemplate(gpu, { rank: index + 1, compact: true, metric: "g3dMark" })).join("")
    : `<div class="empty-state">暂无可展示的图形性能排行数据。</div>`;
}

async function loadLlmRanking() {
  const data = await fetchJson(`/api/gpu/rankings?metric=llmTheoreticalScore&limit=${state.llmRankingLimit}`);
  data.items.forEach((gpu) => state.gpuLookup.set(String(gpu.id), gpu));
  els.rankingLlmList.innerHTML = data.items.length
    ? data.items.map((gpu, index) => gpuRowTemplate(gpu, { rank: index + 1, compact: true, metric: "llmTheoreticalScore" })).join("")
    : `<div class="empty-state">当前没有可展示的 LLM 推理排行数据。</div>`;
}

function bindSearchInputs() {
  const handler = () => {
    state.q = els.searchInput.value;
    state.gpuClass = els.classInput.value;
    state.bus = els.busInput.value;
    syncUrl("push");
    void runSearch();
  };
  els.searchInput.addEventListener("input", handler);
  els.classInput.addEventListener("input", handler);
  els.busInput.addEventListener("input", handler);
}

function bindTabs() {
  els.tabButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      switchTab(button.dataset.tab, "push");
    });
  });
}

function bindRankingControls() {
  els.graphicsRankingLimit.addEventListener("change", () => {
    state.graphicsRankingLimit = els.graphicsRankingLimit.value;
    syncUrl("push");
    void loadGraphicsRanking();
  });
  els.llmRankingLimit.addEventListener("change", () => {
    state.llmRankingLimit = els.llmRankingLimit.value;
    syncUrl("push");
    void loadLlmRanking();
  });
}

function addSelectedGpu(id) {
  if (!state.selected.includes(id) && state.selected.length < 5) {
    state.selected.push(id);
    renderSelected();
    syncUrl("push");
  }
}

function refreshLists() {
  void runSearch();
  void loadGraphicsRanking();
  void loadLlmRanking();
}

function bindRowActions() {
  const handler = (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button) return;
    addSelectedGpu(String(button.dataset.pick));
    refreshLists();
  };
  els.searchResults.addEventListener("click", handler);
  els.rankingGameList.addEventListener("click", handler);
  els.rankingLlmList.addEventListener("click", handler);
}

function bindSelectedActions() {
  els.selectedGpus.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    const id = String(button.dataset.remove);
    state.selected = state.selected.filter((item) => item !== id);
    renderSelected();
    syncUrl("push");
    refreshLists();
  });

  els.clearSelection.addEventListener("click", () => {
    state.selected = [];
    state.compareView = "builder";
    renderSelected();
    els.compareContent.classList.add("hidden");
    els.compareEmpty.classList.remove("hidden");
    syncUrl("push");
    refreshLists();
  });
}

function bindCompareActions() {
  els.compareButton.addEventListener("click", () => void renderCompare());
  els.refreshCompareButton.addEventListener("click", () => void renderCompare());
  els.addMoreButton.addEventListener("click", () => {
    state.compareView = "builder";
    syncUrl("push");
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  els.jumpToResults.addEventListener("click", (event) => {
    event.preventDefault();
    state.compareView = "results";
    syncUrl("push");
    els.compareResults.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function bindPopState() {
  window.addEventListener("popstate", () => {
    hydrateStateFromUrl();
    switchTab(state.tab, "replace");
    renderSelected();
    void refreshAll(true);
  });
}

async function refreshAll(restoreCompare = false) {
  await Promise.all([runSearch(), loadGraphicsRanking(), loadLlmRanking()]);
  if (restoreCompare && state.tab === "compare" && state.compareView === "results" && state.selected.length) {
    await renderCompare({ historyMode: "replace", scroll: false });
  }
}

hydrateStateFromUrl();
switchTab(state.tab, "replace");
renderSelected();
bindTabs();
bindSearchInputs();
bindRankingControls();
bindRowActions();
bindSelectedActions();
bindCompareActions();
bindPopState();
void loadMeta();
void refreshAll(true);
