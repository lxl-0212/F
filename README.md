# 芳和實中 Mini AI Assistant

本專案以「鶯歌最終版」的單一根目錄部署結構、標準庫 MCP 通訊方式與校務查詢介面為基礎，接上芳和實中 Colab 專案的官方網站索引與校務查詢邏輯。

## 功能

- 芳和官方網站索引查詢：教師／處室、分機、請假、行動載具、獎懲、學生手冊及行事曆等校務問題。
- 以官方來源摘錄作答，附上原始頁面連結；查無資料時不臆測。
- 台灣日期與時間快速回答。
- 設定 Gemini OpenAI-compatible API key 後，AI 會用學生容易理解的自然語言整理校方資料、回答追問並附官方來源；未設定時只提供精簡來源摘錄，且一般開放問題不會被誤送去搜尋校規。
- 快速標籤會帶入口語問題，學生可修改後送出；標籤範例以目前索引涵蓋的公告、行事曆、新生、學生資源和課程活動為主。
- Express 網頁介面、`/chat` API 和 `/healthz` 健康檢查。

## 專案結構

```text
.
├── data/fanghe_official_index.json
├── public/index.html
├── scripts/sync_fanghe_official.py
├── hello_tool.py
├── mcp-client.js
├── llm-client-openai.js
├── quick-reply.js
├── server.js
├── package.json
└── render.yaml
```

## 本機啟動

需要 Node.js 18+ 與 Python 3。複製 `.env.example` 為 `.env`，可選填 `OPENAI_API_KEY`（Gemini 的 OpenAI 相容金鑰）；接著：

```bash
npm install
npm start
```

瀏覽器開啟 `http://localhost:3000`。若 Windows 使用 `python` 而非 `python3`，請在 `.env` 設定 `PYTHON_BIN=python`。

## Render 部署

將此資料夾內容放在 GitHub repository 根目錄，連接 Render 的 Blueprint 或建立 Node Web Service：

- Build Command：`npm install`
- Start Command：`node server.js`
- Health Check Path：`/healthz`
- 可選環境變數：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`PYTHON_BIN`

要啟用自然語言整理與一般對話，請在 Render 的 Environment 設定 `OPENAI_API_KEY`（可填 Gemini 的 OpenAI 相容 API 金鑰）。健康檢查 `/healthz` 的 `aiReady` 欄位會顯示 AI 是否已設定。未設定金鑰時，校務查詢仍會回傳精簡官方來源摘錄；一般開放問題會提示管理者設定 AI，不會假裝回答。請確認所選 Render 執行環境有 Python 3。

## 更新芳和官方資料

`data/fanghe_official_index.json` 是 Colab 專案同步得到的資料快照。需要更新時，在可使用 Python `requests` 與 `beautifulsoup4` 的環境執行：

```bash
pip install -r requirements.txt
python scripts/sync_fanghe_official.py
```

更新後檢視變更，再提交索引。資料來源為[臺北市芳和實驗中學官方網站](https://www.fhehs.tp.edu.tw/)。校規及辦理期限請以學校最新公告與正式文件為準。
