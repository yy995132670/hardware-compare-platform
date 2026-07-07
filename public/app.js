const DEFAULT_STATE = {
  tab: "compare",
  compareView: "builder",
  q: "",
  cpuClass: "",
  socket: "",
  selected: [],
  rankingMetric: "cpuMark",
  rankingLimit: "50",
  category: "server",
  categoryMetric: "cpuMark",
  hours: "8",
  util: "25",
  cost: "0.15",
};

const state = {
  ...DEFAULT_STATE,
  cpuLookup: new Map(),
};

const els = {
  metaTotal: document.getElementById("meta-total"),
  metaGenerated: document.getElementById("meta-generated"),
  metaVerification: document.getElementById("meta-verification"),
  searchInput: document.getElementById("search-input"),
  classInput: document.getElementById("class-input"),
  socketInput: document.getElementById("socket-input"),
  searchResults: document.getElementById("search-results"),
  selectedCpus: document.getElementById("selected-cpus"),
  clearSelection: document.getElementById("clear-selection"),
  hoursInput: document.getElementById("hours-input"),
  utilInput: document.getElementById("util-input"),
  costInput: document.getElementById("cost-input"),
  compareButton: document.getElementById("compare-button"),
  compareEmpty: document.getElementById("compare-empty"),
  compareContent: document.getElementById("compare-content"),
  compareSummary: document.getElementById("compare-summary"),
  compareTable: document.getElementById("compare-table"),
  cpuMarkChart: document.getElementById("cpu-mark-chart"),
  singleThreadChart: document.getElementById("single-thread-chart"),
  rankingMetric: document.getElementById("ranking-metric"),
  rankingLimit: document.getElementById("ranking-limit"),
  rankingList: document.getElementById("ranking-list"),
  categorySelect: document.getElementById("category-select"),
  categoryMetric: document.getElementById("category-metric"),
  categorySummary: document.getElementById("category-summary"),
  categoryList: document.getElementById("category-list"),
  addMoreButton: document.getElementById("add-more-button"),
  refreshCompareButton: document.getElementById("refresh-compare-button"),
  jumpToResults: document.getElementById("jump-to-results"),
  compareResults: document.getElementById("compare-results"),
  tabButtons: [...document.querySelectorAll(".tab-button")],
  tabPanels: [...document.querySelectorAll(".tab-panel")],
};

function formatNumber(value) {
  if (value == null || Number.isNaN(value)) {
    return "NA";
  }
  return new Intl.NumberFormat("zh-CN").format(value);
}

function formatDateTime(value) {
  if (!value) {
    return "未知";
  }
  return new Date(value).toLocaleString("zh-CN");
}

function formatCurrency(value) {
  if (value == null || Number.isNaN(value)) {
    return "NA";
  }
  return `$${value.toFixed(2)}`;
}

function formatDiff(value) {
  if (value == null || Number.isNaN(value)) {
    return "NA";
  }
  if (value === 0) {
    return "0.0%";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
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
  return metric === "singleThreadRating" ? "单线程评分" : "综合评分";
}

function urlFromState() {
  const params = new URLSearchParams();
  if (state.q) params.set("q", state.q);
  if (state.cpuClass) params.set("class", state.cpuClass);
  if (state.socket) params.set("socket", state.socket);
  if (state.selected.length) params.set("selected", state.selected.join(","));
  if (state.compareView !== DEFAULT_STATE.compareView) params.set("compareView", state.compareView);
  if (state.rankingMetric !== DEFAULT_STATE.rankingMetric) params.set("rankingMetric", state.rankingMetric);
  if (state.rankingLimit !== DEFAULT_STATE.rankingLimit) params.set("rankingLimit", state.rankingLimit);
  if (state.category !== DEFAULT_STATE.category) params.set("category", state.category);
  if (state.categoryMetric !== DEFAULT_STATE.categoryMetric) params.set("categoryMetric", state.categoryMetric);
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
    return;
  }
  window.history.replaceState({}, "", nextUrl);
}

function applyStateToControls() {
  els.searchInput.value = state.q;
  els.classInput.value = state.cpuClass;
  els.socketInput.value = state.socket;
  els.rankingMetric.value = state.rankingMetric;
  els.rankingLimit.value = state.rankingLimit;
  els.categorySelect.value = state.category;
  els.categoryMetric.value = state.categoryMetric;
  els.hoursInput.value = state.hours;
  els.utilInput.value = state.util;
  els.costInput.value = state.cost;
}

function hydrateStateFromUrl() {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  state.tab = (url.hash || "#compare").replace("#", "") || DEFAULT_STATE.tab;
  if (!["compare", "ranking", "category"].includes(state.tab)) {
    state.tab = DEFAULT_STATE.tab;
  }
  state.compareView = params.get("compareView") || DEFAULT_STATE.compareView;
  if (!["builder", "results"].includes(state.compareView)) {
    state.compareView = DEFAULT_STATE.compareView;
  }
  state.q = params.get("q") || DEFAULT_STATE.q;
  state.cpuClass = params.get("class") || DEFAULT_STATE.cpuClass;
  state.socket = params.get("socket") || DEFAULT_STATE.socket;
  state.selected = (params.get("selected") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
  state.rankingMetric = params.get("rankingMetric") || DEFAULT_STATE.rankingMetric;
  state.rankingLimit = params.get("rankingLimit") || DEFAULT_STATE.rankingLimit;
  state.category = params.get("category") || DEFAULT_STATE.category;
  state.categoryMetric = params.get("categoryMetric") || DEFAULT_STATE.categoryMetric;
  state.hours = params.get("hours") || DEFAULT_STATE.hours;
  state.util = params.get("util") || DEFAULT_STATE.util;
  state.cost = params.get("cost") || DEFAULT_STATE.cost;
  applyStateToControls();
}

function switchTab(nextTab, historyMode = "push") {
  state.tab = nextTab;
  els.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === nextTab);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.panel === nextTab);
  });
  syncUrl(historyMode);
}

function createActionButton(cpuId) {
  const selected = state.selected.includes(String(cpuId));
  return `
    <button class="pick-button" data-pick="${cpuId}" ${selected ? "disabled" : ""} type="button">
      ${selected ? "已加入对比" : "加入对比"}
    </button>
  `;
}

function cpuRowTemplate(cpu, options = {}) {
  const rank = options.rank ? `<div class="cpu-rank">${options.rank}</div>` : `<div class="cpu-rank">#</div>`;
  const compactClass = options.compact ? "compact" : "";
  const infoMetrics = options.compact
    ? `
      <div class="cpu-metric"><span>${metricLabel(options.metric || "cpuMark")}</span><strong>${formatNumber(cpu[options.metric || "cpuMark"])}</strong></div>
      <div class="cpu-metric"><span>分类</span><strong>${cpu.categoryLabel || "未分类"}</strong></div>
      <div class="cpu-metric"><span>热设计功耗</span><strong>${cpu.tdp || "NA"}</strong></div>
      <div class="cpu-metric"><span>单线程评分</span><strong>${formatNumber(cpu.singleThreadRating)}</strong></div>
      <div class="cpu-actions">${createActionButton(cpu.id)}</div>
    `
    : `
      <div class="cpu-metric"><span>综合评分</span><strong>${formatNumber(cpu.cpuMark)}</strong></div>
      <div class="cpu-metric"><span>单线程评分</span><strong>${formatNumber(cpu.singleThreadRating)}</strong></div>
      <div class="cpu-metric"><span>总排名</span><strong>${formatNumber(cpu.cpuRank)}</strong></div>
      <div class="cpu-metric"><span>分类</span><strong>${cpu.categoryLabel || "未分类"}</strong></div>
      <div class="cpu-metric"><span>热设计功耗</span><strong>${cpu.tdp || "NA"}</strong></div>
      <div class="cpu-actions">${createActionButton(cpu.id)}</div>
    `;

  return `
    <article class="cpu-row ${compactClass}">
      ${rank}
      <div class="cpu-main">
        <strong>${cpu.name}</strong>
        <div class="cpu-sub">
          ${cpu.cpuClass || "未标注类别"} · ${cpu.socketType || "插槽未标注"} · 首次上榜 ${cpu.firstSeenOnChart || "未知"}
        </div>
      </div>
      ${infoMetrics}
    </article>
  `;
}

function renderSelected() {
  els.selectedCpus.innerHTML = "";
  if (!state.selected.length) {
    els.selectedCpus.innerHTML = `<span class="cpu-sub">尚未选择 CPU</span>`;
    return;
  }

  state.selected.forEach((id) => {
    const cpu = state.cpuLookup.get(String(id));
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `<span>${cpu ? cpu.name : `CPU #${id}`}</span><button type="button" data-remove="${id}">×</button>`;
    els.selectedCpus.appendChild(chip);
  });
}

function renderCompareSummary(compareData) {
  const lowestEnergyCpu = [...compareData.cpus]
    .filter((cpu) => cpu.energyUsage.runningCostPerYear != null)
    .sort((a, b) => a.energyUsage.runningCostPerYear - b.energyUsage.runningCostPerYear)[0];
  const bestCpuMark = [...compareData.cpus].sort((a, b) => (b.cpuMark || 0) - (a.cpuMark || 0))[0];
  const bestSingle = [...compareData.cpus].sort((a, b) => (b.singleThreadRating || 0) - (a.singleThreadRating || 0))[0];

  els.compareSummary.innerHTML = `
    <div class="compare-summary-card">
      <span>综合评分领先</span>
      <strong>${bestCpuMark ? bestCpuMark.name : "NA"}</strong>
    </div>
    <div class="compare-summary-card">
      <span>单线程评分领先</span>
      <strong>${bestSingle ? bestSingle.name : "NA"}</strong>
    </div>
    <div class="compare-summary-card">
      <span>年电费最低</span>
      <strong>${lowestEnergyCpu ? `${lowestEnergyCpu.name} · ${formatCurrency(lowestEnergyCpu.energyUsage.runningCostPerYear)}` : "NA"}</strong>
    </div>
  `;
}

async function runSearch() {
  const q = encodeURIComponent(state.q.trim());
  const cpuClass = encodeURIComponent(state.cpuClass.trim());
  const socketType = encodeURIComponent(state.socket.trim());
  const data = await fetchJson(`/api/cpus?q=${q}&cpuClass=${cpuClass}&socketType=${socketType}&limit=80`);
  data.items.forEach((cpu) => state.cpuLookup.set(String(cpu.id), cpu));
  els.searchResults.innerHTML = data.items.map((cpu, index) => cpuRowTemplate(cpu, { rank: index + 1 })).join("");
}

function renderBarChart(el, cpus, metricKey) {
  const max = Math.max(...cpus.map((cpu) => cpu[metricKey] || 0), 1);
  el.innerHTML = cpus
    .map((cpu) => {
      const width = ((cpu[metricKey] || 0) / max) * 100;
      return `
        <div class="bar-row">
          <div class="bar-label">${cpu.name}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
          <div class="bar-value">${formatNumber(cpu[metricKey])}</div>
        </div>
      `;
    })
    .join("");
}

function renderCompareTable(compareData) {
  const rows = [
    ["插槽类型", "socketType"],
    ["CPU 类别", "cpuClass"],
    ["基础频率", "clockspeed"],
    ["睿频频率", "turboSpeed"],
    ["物理核心数", "physicalCoresText"],
    ["缓存", "cache"],
    ["热设计功耗", "tdp"],
    ["首次上榜时间", "firstSeenOnChart"],
    ["CPU 排名", "cpuRank"],
    ["CPU 综合评分", "cpuMark"],
    ["单线程评分（相对组内最高差值）", "singleThreadDiff"],
    ["综合评分（相对组内最高差值）", "cpuMarkDiff"],
    ["预估年耗电成本", "energyYear"],
    ["预估年耗电量（kWh）", "energyKwh"],
    ["样本数量", "sampleCount"],
    ["数据来源", "source"],
    ["字段完整性", "verification"],
  ];

  const header = `
    <thead>
      <tr>
        <th>字段</th>
        ${compareData.cpus.map((cpu) => `<th>${cpu.name}</th>`).join("")}
      </tr>
    </thead>
  `;

  const body = rows
    .map(([label, key]) => {
      const cells = compareData.cpus
        .map((cpu) => {
          let value = cpu[key];
          if (key === "singleThreadDiff") {
            value = `${formatNumber(cpu.singleThreadRating)}（${formatDiff(cpu.singleThreadDiffToMaxPercent)}）`;
          }
          if (key === "cpuMarkDiff") {
            value = `${formatNumber(cpu.cpuMark)}（${formatDiff(cpu.cpuMarkDiffToMaxPercent)}）`;
          }
          if (key === "energyYear") {
            value = formatCurrency(cpu.energyUsage.runningCostPerYear);
          }
          if (key === "energyKwh") {
            value =
              cpu.energyUsage.powerConsumptionPerYearKwh == null
                ? "NA"
                : cpu.energyUsage.powerConsumptionPerYearKwh.toFixed(2);
          }
          if (key === "source") {
            value = cpu.source?.primary || "未知";
          }
          if (key === "verification") {
            value = cpu.verification?.missingFields?.length
              ? `缺失字段：${cpu.verification.missingFields.join("、")}`
              : "已通过基础完整性检查";
          }
          if (key === "cpuRank" || key === "cpuMark" || key === "sampleCount") {
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

async function renderCompare(options = {}) {
  if (!state.selected.length) {
    window.alert("请先选择至少一款 CPU。");
    return;
  }

  state.hours = els.hoursInput.value;
  state.util = els.utilInput.value;
  state.cost = els.costInput.value;
  state.compareView = "results";
  syncUrl(options.historyMode || "push");

  const compareData = await fetchJson("/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ids: state.selected,
      hoursPerDay: Number(state.hours),
      utilizationPercent: Number(state.util),
      costPerKwh: Number(state.cost),
    }),
  });

  compareData.cpus.forEach((cpu) => state.cpuLookup.set(String(cpu.id), cpu));
  els.compareEmpty.classList.add("hidden");
  els.compareContent.classList.remove("hidden");
  renderCompareSummary(compareData);
  renderBarChart(els.cpuMarkChart, compareData.cpus, "cpuMark");
  renderBarChart(els.singleThreadChart, compareData.cpus, "singleThreadRating");
  renderCompareTable(compareData);
  renderSelected();

  if (options.scroll !== false) {
    els.compareResults.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadMeta() {
  const data = await fetchJson("/api/meta");
  els.metaTotal.textContent = data.meta ? `${formatNumber(data.meta.detailRecordsStored)} 款 CPU` : "未生成";
  els.metaGenerated.textContent = data.meta ? formatDateTime(data.meta.generatedAt) : "未生成";
  els.metaVerification.textContent = data.verification
    ? data.verification.coverageComplete
      ? `覆盖完整，字段缺失 ${formatNumber(data.verification.incompleteCount)}`
      : `仍有 ${formatNumber(data.verification.missingDetailsCount)} 项待补齐`
    : "未校验";
}

async function loadRanking() {
  const data = await fetchJson(`/api/rankings?metric=${state.rankingMetric}&limit=${state.rankingLimit}`);
  data.items.forEach((cpu) => state.cpuLookup.set(String(cpu.id), cpu));
  els.rankingList.innerHTML = data.items
    .map((cpu, index) => cpuRowTemplate(cpu, { rank: index + 1, compact: true, metric: state.rankingMetric }))
    .join("");
}

async function loadCategoryRanking() {
  const data = await fetchJson(`/api/categories/${state.category}/rankings?metric=${state.categoryMetric}&limit=100`);
  data.items.forEach((cpu) => state.cpuLookup.set(String(cpu.id), cpu));

  els.categorySummary.innerHTML = `
    <div class="summary-grid">
      <div class="summary-item">
        <span>分类</span>
        <strong>${data.categoryLabel}</strong>
      </div>
      <div class="summary-item">
        <span>当前展示</span>
        <strong>${formatNumber(data.items.length)} 款</strong>
      </div>
      <div class="summary-item">
        <span>评分维度</span>
        <strong>${metricLabel(state.categoryMetric)}</strong>
      </div>
    </div>
  `;

  els.categoryList.innerHTML = data.items
    .map((cpu, index) => cpuRowTemplate(cpu, { rank: index + 1, compact: true, metric: state.categoryMetric }))
    .join("");
}

function bindSearchInputs() {
  const handler = () => {
    state.q = els.searchInput.value;
    state.cpuClass = els.classInput.value;
    state.socket = els.socketInput.value;
    syncUrl("push");
    void runSearch();
  };

  els.searchInput.addEventListener("input", handler);
  els.classInput.addEventListener("input", handler);
  els.socketInput.addEventListener("input", handler);
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
  els.rankingMetric.addEventListener("change", () => {
    state.rankingMetric = els.rankingMetric.value;
    syncUrl("push");
    void loadRanking();
  });

  els.rankingLimit.addEventListener("change", () => {
    state.rankingLimit = els.rankingLimit.value;
    syncUrl("push");
    void loadRanking();
  });
}

function bindCategoryControls() {
  els.categorySelect.addEventListener("change", () => {
    state.category = els.categorySelect.value;
    syncUrl("push");
    void loadCategoryRanking();
  });

  els.categoryMetric.addEventListener("change", () => {
    state.categoryMetric = els.categoryMetric.value;
    syncUrl("push");
    void loadCategoryRanking();
  });
}

function addSelectedCpu(id) {
  if (!state.selected.includes(id) && state.selected.length < 5) {
    state.selected.push(id);
    renderSelected();
    syncUrl("push");
  }
}

function bindRowActions() {
  const handler = (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button) {
      return;
    }
    addSelectedCpu(String(button.dataset.pick));
    void runSearch();
    void loadRanking();
    void loadCategoryRanking();
  };

  els.searchResults.addEventListener("click", handler);
  els.rankingList.addEventListener("click", handler);
  els.categoryList.addEventListener("click", handler);
}

function bindSelectedActions() {
  els.selectedCpus.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) {
      return;
    }
    const id = String(button.dataset.remove);
    state.selected = state.selected.filter((item) => item !== id);
    renderSelected();
    syncUrl("push");
    void runSearch();
    void loadRanking();
    void loadCategoryRanking();
  });

  els.clearSelection.addEventListener("click", () => {
    state.selected = [];
    state.compareView = "builder";
    renderSelected();
    els.compareContent.classList.add("hidden");
    els.compareEmpty.classList.remove("hidden");
    syncUrl("push");
    void runSearch();
    void loadRanking();
    void loadCategoryRanking();
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
  await Promise.all([runSearch(), loadRanking(), loadCategoryRanking()]);
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
bindCategoryControls();
bindRowActions();
bindSelectedActions();
bindCompareActions();
bindPopState();
void loadMeta();
void refreshAll(true);
