import OpenAI from 'openai';

const SCHOOL = '臺北市芳和實驗中學';
const HOME = 'https://www.fhehs.tp.edu.tw/';
const SYSTEM = `你是${SCHOOL}的校園 AI 助理。使用繁體中文，回答自然、簡潔、有禮貌。學校制度、人員、分機、行事曆和校園資訊，只能依據提供的芳和官方資料，不要猜測。先清楚回答問題，再列出必要步驟；只在資料有提供時附上正式來源。找不到依據時，明確說目前找不到可以直接支持問題的校方資料。一般開放問題可提供一般資訊，但要和校方規定清楚區分。`;

function parse(raw) { try { return JSON.parse(raw); } catch { return {}; } }
function fallbackNatural(raw) {
  const data = parse(raw);
  const rows = Array.isArray(data.結果) ? data.結果 : [];
  if (!rows.length) return `${data.錯誤 || '目前找不到可以直接支持這個問題的校方資料。'}\n\n🔗 資料來源\n• ${data.官方首頁 || HOME}`;
  const body = rows.map(item => `${item.標題 ? `【${item.標題}】\n` : ''}${item.原文摘錄 || ''}${item.官方來源 ? `\n來源：${item.官方來源}` : ''}`).join('\n\n');
  return `${body}\n\n🔗 資料來源\n• ${data.官方首頁 || HOME}`;
}
function addSources(answer, raw) {
  const data = parse(raw);
  const urls = [...new Set([...(data.結果 || []).map(x => x?.官方來源), data.官方首頁].filter(Boolean))];
  if (!urls.length || answer.includes('資料來源')) return answer;
  return `${answer}\n\n🔗 資料來源\n${urls.map(url => `• ${url}`).join('\n')}`;
}

export class OpenAILLMClient {
  constructor(mcp) {
    this.mcp = mcp;
    const key = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    this.enabled = Boolean(key);
    this.openai = this.enabled ? new OpenAI({
      baseURL: process.env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai/',
      apiKey: key, timeout: 45000, maxRetries: 0,
    }) : null;
    this.model = process.env.OPENAI_MODEL || 'gemini-3.1-flash-lite';
  }

  async chat(messages, { forceTool = false } = {}) {
    const latest = String([...messages].reverse().find(m => m?.role === 'user')?.content || '');
    const followUp = /^(那|那麼|他|她|這位|這個|另外|還有|同一個|該)/.test(latest.trim());
    const query = followUp
      ? messages.filter(m => m?.role === 'user').slice(-3).map(m => m.content).join('，')
      : latest;
    const raw = forceTool ? await this.mcp.callTool('search_school_info', { query }) : null;
    if (!this.enabled) {
      const result = raw ?? await this.mcp.callTool('search_school_info', { query });
      const answer = fallbackNatural(result);
      return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
    }
    const history = [{ role: 'system', content: SYSTEM }, ...messages.map(m => ({
      role: m.role,
      content: Array.isArray(m.content) ? m.content.filter(x => x?.type === 'text').map(x => x.text).join('') : m.content,
    }))];
    if (forceTool) {
      const lastUser = history.map(m => m.role).lastIndexOf('user');
      history[lastUser].content = `${history[lastUser].content}\n\n芳和官方資料（只依據這些資料回答）：\n${raw}`;
      try {
        const completion = await this.openai.chat.completions.create({ model: this.model, messages: history, max_tokens: 1200 });
        const answer = addSources(String(completion.choices?.[0]?.message?.content || '') || fallbackNatural(raw), raw);
        return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
      } catch (error) {
        console.error(`[LLM SCHOOL FALLBACK] ${error.message || error}`);
        const answer = fallbackNatural(raw);
        return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
      }
    }
    try {
      const first = await this.openai.chat.completions.create({ model: this.model, messages: history, tools: this.mcp.getOpenAITools(), tool_choice: 'auto', max_tokens: 1200 });
      const msg = first.choices?.[0]?.message || {};
      history.push(msg);
      if (!msg.tool_calls?.length) {
        const answer = String(msg.content || '');
        return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
      }
      for (const call of msg.tool_calls) {
        let args = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
        const result = await this.mcp.callTool(call.function.name, args);
        history.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      const final = await this.openai.chat.completions.create({ model: this.model, messages: history, max_tokens: 1200 });
      let answer = String(final.choices?.[0]?.message?.content || '');
      for (const item of history.filter(x => x.role === 'tool')) answer = addSources(answer, item.content);
      return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
    } catch (error) {
      console.error(`[LLM FALLBACK] ${error.message || error}`);
      const result = await this.mcp.callTool('search_school_info', { query });
      const answer = fallbackNatural(result);
      return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
    }
  }
}