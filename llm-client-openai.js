import OpenAI from 'openai';

const SCHOOL = '臺北市芳和實驗中學';
const HOME = 'https://www.fhehs.tp.edu.tw/';
const SYSTEM = `你是${SCHOOL}的校園 AI 助理，主要服務國高中學生。使用繁體中文，像耐心的老師一樣用簡單、自然、清楚的話回答。先直接回答學生真正想知道的事；必要時用短句或步驟說明，遇到校方術語要順手解釋。學生問「怎麼辦」或日常情境時，給可執行的重點，不要把法規原文、文件標題或整段搜尋結果直接貼上，也不要每題都回答成法規摘要。只有學生明確問規定、條文或正式依據時，才簡短說明相關規定。學校制度、人員、分機、行事曆和校園資訊只能依據提供的官方資料，不可猜測；資料不足時坦白說目前查不到，並提供最相關的官方來源。一般開放問題正常對話回答，不要硬套校規。校務回答結尾要附「🔗 資料來源」及工具提供的官方連結。`;

function parse(raw) { try { return JSON.parse(raw); } catch { return {}; } }
function fallbackNatural(raw) {
  const data = parse(raw);
  const rows = Array.isArray(data.結果) ? data.結果 : [];
  if (!rows.length) return `${data.錯誤 || '目前找不到可以直接支持這個問題的校方資料。'}\n\n🔗 資料來源\n• ${data.官方首頁 || HOME}`;
  const body = rows.slice(0, 3).map(item => {
    const excerpt = String(item.原文摘錄 || '').replace(/\s+/g, ' ').trim();
    const shortExcerpt = excerpt.length > 420 ? `${excerpt.slice(0, 417)}…` : excerpt;
    return `• ${item.標題 || '校方資料'}${shortExcerpt ? `\n  ${shortExcerpt}` : ''}`;
  }).join('\n');
  const sources = [...new Set(rows.slice(0, 3).map(item => item.官方來源).filter(Boolean))];
  return `我從校方公開資料找到以下相關資訊：\n${body}\n\n若你想問更具體的情況，可以直接接著描述。\n\n🔗 資料來源\n${(sources.length ? sources : [data.官方首頁 || HOME]).map(url => `• ${url}`).join('\n')}`;
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
      if (!raw) {
        const answer = '我目前可以查找校方公開資料，但自然語言整理功能尚未設定 AI 服務。管理者需要在 Render 設定 OPENAI_API_KEY（或 GEMINI_API_KEY）後，才能用對話方式回答一般問題。';
        return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
      }
      const answer = fallbackNatural(raw);
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
