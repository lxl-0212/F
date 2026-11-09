import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { MCPClient } from './mcp-client.js';
import { OpenAILLMClient } from './llm-client-openai.js';
import { getQuickReply } from './quick-reply.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const mcp = new MCPClient();
const llm = new OpenAILLMClient(mcp);
let mcpError = null;

const SCHOOL = /校務|校園|學生專區|老師|教師|主任|組長|職稱|姓名|分機|電話|教室|場館|行事曆|行程|公告|校園活動|活動消息|課程發展|升學|新生|入學|行政單位|社團|外展|探索|學校特色|學校簡介|校規|規定|法規|條文|請假|行動載具|手機|獎懲|成績|考試|補考|學分|畢業|編班|轉班|抵免|班級|學生手冊/;
const FOLLOW_UP = /^(那|那麼|他|她|這位|這個|另外|還有|同一個|該).{0,30}/;
const MONTH_QUERY = /(?:\d{1,2}|[一二三四五六七八九十]{1,3})月/;
const SHORT_LOOKUP = /^[\p{Script=Han}]{2,4}$/u;
const ROOM_CODE_QUERY = /^(?:\d+[a-z]|[a-z]\d+)$/i;
const GREETINGS = new Set(['你好','您好','謝謝','早安','午安','晚安','哈囉','嗨']);

app.get('/healthz', (req, res) => {
  res.json({ ok: true, mcpReady: mcp.ready, aiReady: llm.enabled, mcpTools: mcp.tools.map(x => x.name), mcpError });
});

app.post('/chat', async (req, res) => {
  const requestId = randomUUID();
  const startedAt = Date.now();
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || !messages.length || messages.length > 100 || messages.some(m => !m || !['user','assistant'].includes(m.role) || typeof m.content !== 'string')) {
      return res.status(400).json({error:'messages 必須是最多 100 則、且只包含 user/assistant 文字內容的陣列。'});
    }
    const history = messages.slice(-40);
    const q = [...history].reverse().find(x => x.role === 'user')?.content || '';
    const recentSchoolContext = history.slice(-6).some(m => m.role === 'user' && SCHOOL.test(m.content));
    const shortLookup = SHORT_LOOKUP.test(q) && !GREETINGS.has(q);
    const isSchoolQuery = SCHOOL.test(q) || MONTH_QUERY.test(q) || ROOM_CODE_QUERY.test(q.trim()) || shortLookup || (recentSchoolContext && FOLLOW_UP.test(q));
    const quick = await getQuickReply(q);
    if (quick !== null) return res.json({ reply: quick, messages: [...history, {role:'assistant', content:quick}] });
    if (isSchoolQuery && !mcp.ready) {
      console.warn(`[CHAT] id=${requestId} status=503 durationMs=${Date.now() - startedAt}`);
      return res.status(503).json({error:'校務資料服務尚未完成啟動，請稍後再試。', detail:mcpError});
    }
    const result = await llm.chat(history, { forceTool: isSchoolQuery });
    console.info(`[CHAT] id=${requestId} status=200 durationMs=${Date.now() - startedAt}`);
    res.json(result);
  } catch (e) {
    // A downstream model/service may itself report status 400. That is not a
    // malformed browser request; reserve HTTP 400 for our explicit validation
    // and JSON parsing handlers below.
    const upstreamStatus = Number.isInteger(e.status) && e.status >= 400 && e.status < 600 ? e.status : 500;
    const status = upstreamStatus === 400 ? 502 : upstreamStatus;
    console.error(`[CHAT ERROR] id=${requestId} status=${status} upstreamStatus=${upstreamStatus} durationMs=${Date.now() - startedAt} ${e.message || e}`);
    res.status(status).json({error:status === 502 ? '查詢服務暫時無法完成請求，請稍後再試。' : (e.message || '查詢失敗'), requestId});
  }
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.type !== 'entity.parse.failed' && err.type !== 'entity.too.large') return next(err);
  const status = err.type === 'entity.too.large' ? 413 : 400;
  res.status(status).json({error:status === 413 ? '請求內容超過 1 MB。' : '請求格式錯誤，請重新整理頁面後再試。'});
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Campus AI Assistant listening on ${port}`));

async function startMcp() {
  let delay = 1000;
  while (!mcp.ready) {
    try {
      await mcp.connect();
      mcpError = null;
      return;
    } catch (err) {
      mcpError = err.message;
      console.error('[MCP STARTUP ERROR]', err);
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 30000);
    }
  }
}

startMcp();
