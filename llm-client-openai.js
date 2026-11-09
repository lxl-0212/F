import OpenAI from 'openai';

const SCHOOL = '臺北市芳和實驗中學';
const HOME = 'https://www.fhehs.tp.edu.tw/';
const SYSTEM = `你是${SCHOOL}的校園 AI 助理，主要服務國高中學生。請用繁體中文，語氣親切、溫暖但不囉嗦，像耐心的老師一樣回答。校務問題先用一句話直接回答，再視需要補充最多兩個重點；一般不超過 3 句短句（來源區除外）。避免公文腔、艱深詞和長篇說明；遇到必要的校方術語，立刻用白話解釋。學生問「怎麼辦」或日常情境時，說清楚下一步，不要把法規原文、文件標題或整段搜尋結果貼上，也不要每題都回答成法規摘要。只有學生明確問規定、條文或正式依據時，才簡短說明相關規定。學校制度、人員、分機、行事曆和校園資訊只能依據提供的官方資料，不可猜測；資料不足時親切地說目前查不到，並提供最相關的官方來源。一般開放問題正常對話回答，不要硬套校規。校務回答結尾要附「🔗 資料來源」及工具提供的官方連結。`;

function parse(raw) { try { return JSON.parse(raw); } catch { return {}; } }
function conciseAnswer(value, limit = 260) {
  const text = String(value || '').replace(/\n*🔗\s*資料來源[\s\S]*$/i, '').trim();
  if (text.length <= limit) return text;
  const sentences = text.split(/(?<=[。！？])/).map(part => part.trim()).filter(Boolean);
  let answer = '';
  for (const sentence of sentences.slice(0, 3)) {
    if (answer.length + sentence.length > limit) break;
    answer += sentence;
  }
  if (!answer) answer = `${text.slice(0, limit - 1).trimEnd()}…`;
  return answer;
}
function fallbackNatural(raw) {
  const data = parse(raw);
  const rows = Array.isArray(data.結果) ? data.結果 : [];
  if (!rows.length) return `抱歉，我目前沒找到能回答這題的校方資料。你可以看看官方網站，或提供多一點關鍵字，我再幫你找。\n\n🔗 資料來源\n• ${data.官方首頁 || HOME}`;
  const body = rows.slice(0, 2).map(item => {
    const excerpt = String(item.原文摘錄 || '').replace(/\s+/g, ' ').trim();
    const shortExcerpt = excerpt.length > 140 ? `${excerpt.slice(0, 137)}…` : excerpt;
    return `• **${item.標題 || '校方資料'}**${shortExcerpt ? `：${shortExcerpt}` : ''}`;
  }).join('\n');
  const sources = [...new Set(rows.slice(0, 1).map(item => item.官方來源).filter(Boolean))];
  return `我幫你找到相關校方資訊：\n${body}\n\n點來源可以看完整內容，有需要也可以再問我。\n\n🔗 資料來源\n${(sources.length ? sources : [data.官方首頁 || HOME]).map(url => `• ${url}`).join('\n')}`;
}
function addSources(answer, raw) {
  const data = parse(raw);
  const resultUrls = (data.結果 || []).map(x => x?.官方來源).filter(Boolean);
  const urls = [...new Set(resultUrls.length ? resultUrls : [data.官方首頁].filter(Boolean))];
  if (!urls.length) return answer;
  const cleanAnswer = String(answer || '').replace(/\n*🔗\s*資料來源[\s\S]*$/i, '').trim();
  return `${cleanAnswer}\n\n🔗 資料來源\n${urls.slice(0, 2).map(url => `• ${url}`).join('\n')}`;
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
        const answer = '我現在還不能自然對話。請管理者在 Render 開啟 AI 服務，之後我就能用簡單的方式回答你。';
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
        const answer = addSources(conciseAnswer(String(completion.choices?.[0]?.message?.content || '') || fallbackNatural(raw)), raw);
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
        const answer = conciseAnswer(String(msg.content || ''));
        return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
      }
      for (const call of msg.tool_calls) {
        let args = {}; try { args = JSON.parse(call.function.arguments || '{}'); } catch {}
        const result = await this.mcp.callTool(call.function.name, args);
        history.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      const final = await this.openai.chat.completions.create({ model: this.model, messages: history, max_tokens: 1200 });
      let answer = conciseAnswer(String(final.choices?.[0]?.message?.content || ''));
      const toolSources = history.filter(x => x.role === 'tool').flatMap(item => {
        const data = parse(item.content);
        return [...(data.結果 || []).map(x => x?.官方來源), data.官方首頁].filter(Boolean);
      });
      answer = addSources(answer, JSON.stringify({結果:toolSources.map(官方來源=>({官方來源}))}));
      return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
    } catch (error) {
      console.error(`[LLM FALLBACK] ${error.message || error}`);
      const result = await this.mcp.callTool('search_school_info', { query });
      const answer = fallbackNatural(result);
      return { reply: answer, messages: [...messages, { role: 'assistant', content: answer }] };
    }
  }
}
