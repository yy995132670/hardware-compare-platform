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

<img width="2876" height="900" alt="image" src="https://github.com/user-attachments/assets/60fab132-0023-4260-8a57-91bef8b06165" />
<img width="2080" height="1362" alt="image" src="https://github.com/user-attachments/assets/d27b89b8-7e27-45a9-9af5-671e0a21ab71" />
<img width="1520" height="1326" alt="image" src="https://github.com/user-attachments/assets/4d1f88ed-f5d9-4efb-920f-1ccb28548585" />
<img width="1540" height="1186" alt="image" src="https://github.com/user-attachments/assets/d88233b1-766b-4bb1-a048-6db706550a8c" />
<img width="1018" height="1438" alt="image" src="https://github.com/user-attachments/assets/3b851e90-f96d-420e-afe1-de07cf0e608a" />

## 快速开始

### 1. 克隆仓库

```bash
git clone git@github.com:yy995132670/hardware-compare-platform.git
cd hardware-compare-platform
```

> 后续所有命令都在 `hardware-compare-platform/` 目录下运行。
> `npm run xxx` 会自动读取该目录下的 `package.json` 中定义的脚本。

### 2. 安装依赖

```bash
npm install
```

### 3. 拉取数据

数据文件位于 `data/` 目录，不包含在仓库中，需通过脚本自行抓取。

**CPU 数据**

```bash
npm run scrape    # 抓取 PassMark CPU 跑分
npm run enrich    # 补充 CPU 规格字段
npm run verify    # 验证数据集
```

**GPU 数据**

```bash
npm run scrape:gpus      # 抓取 PassMark GPU 跑分
npm run enrich:gpus      # 补充 GPU 规格字段
npm run scrape:gpu-llm   # 抓取 MLPerf LLM 跑分
```

> 抓取脚本基于 Playwright，首次运行需安装浏览器：
> ```bash
> npx playwright install chromium
> ```

### 4. 启动服务

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
- 数据主要从PassMark扒取，缺少信息从其它地方补全，可能会存在数据有误问题，仅供参考
- GPU的LLM性能为估算，未经过实际测试，仅供参考
- 项目默认监听 `2680` 端口，可通过 `PORT` 环境变量覆盖
