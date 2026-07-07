# Hardware Compare Platform (硬件对比平台)

中文 CPU / GPU 本地对比平台，包含 PassMark 跑分抓取、MLPerf LLM GPU 推理跑分整合、排行榜与分类对比。

## 项目结构

```
├── server.js                 # Express 后端服务（端口 2680）
├── package.json
├── public/
│   ├── landing.html          # CPU/GPU 平台导航页
│   ├── index.html            # CPU 对比页面
│   ├── gpu.html              # GPU 对比页面
│   ├── app.js                # CPU 前端逻辑
│   ├── gpu-app.js            # GPU 前端逻辑
│   └── styles.css            # 通用样式
├── scripts/
│   ├── scrape-passmark.js        # 抓取 PassMark CPU 数据
│   ├── enrich-cpu-data.js        # 补充 CPU 规格字段
│   ├── verify-dataset.js         # 验证 CPU 数据集
│   ├── scrape-passmark-gpus.js   # 抓取 PassMark GPU 数据
│   ├── enrich-gpu-data.js        # 补充 GPU 规格字段
│   ├── fetch-mlperf-gpu-llm.js   # 拉取 MLPerf GPU LLM 跑分
│   └── supplement-server-gpus.js # 补充服务器 GPU 数据
├── data/                     # 数据文件（需自行拉取）
└── scripts/
    ├── start-linux.sh
    └── stop-linux.sh
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 拉取数据

第一次运行需要先拉取数据集。数据文件位于 `data/` 目录，包含 CPU/GPU 跑分、规格、验证报告等。

**方法一：从上游仓库拉取（推荐）**

```bash
# 从项目 data 分支或上游仓库拉取数据
git clone --depth 1 <data-repo-url> tmp-data
cp -r tmp-data/* data/
rm -rf tmp-data
```

**方法二：自行抓取（需要 Playwright）**

```bash
# CPU 数据
npm run scrape           # 抓取 PassMark CPU 跑分
npm run enrich           # 补充 CPU 规格字段
npm run verify           # 验证数据集

# GPU 数据
npm run scrape:gpus      # 抓取 PassMark GPU 跑分
npm run enrich:gpus      # 补充 GPU 规格字段
npm run scrape:gpu-llm   # 抓取 MLPerf LLM 跑分
```

> 抓取脚本基于 Playwright，首次运行需安装浏览器：
> ```bash
> npx playwright install chromium
> ```

### 3. 启动服务

```bash
npm start
```

浏览器打开 http://localhost:2680 进入导航页，选择 CPU 或 GPU 平台。

## 功能

- **CPU 对比页面** — PassMark 评分、排名、型号搜索、分类排行榜、参数对比、能耗成本估算
- **GPU 对比页面** — GPU 跑分、DirectX 图形跑分、MLPerf LLM 推理跑分、分类筛选、对比图表
- **中文搜索** — 原生中文关键词检索
- **分类榜单** — 按桌面/服务器/笔记本等分类排行

## 注意事项

- `data/` 目录下的 JSON 数据文件较大（CPU ~60MB, GPU ~35MB），不包含在此仓库中
- `node_modules/` 不包含在仓库中
- 项目默认监听 `2680` 端口，可通过 `PORT` 环境变量覆盖