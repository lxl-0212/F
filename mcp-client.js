import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class MCPClient {
  constructor() {
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.tools = [];
    this.ready = false;
  }

  async connect() {
    if (this.ready) return;
    if (this.proc) throw new Error('MCP 正在連線');
    const python = process.env.PYTHON_BIN || 'python3';
    const proc = spawn(python, ['-u', 'hello_tool.py'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    this.proc = proc;
    proc.on('error', err => this._failAll(err));
    proc.on('exit', (code, signal) => {
      if (code !== 0) this._failAll(new Error(`MCP server exited (code=${code}, signal=${signal})`));
      if (this.proc === proc) {
        this.proc = null;
        this.ready = false;
      }
    });
    proc.stderr.on('data', b => console.error(`[MCP] ${String(b).trim()}`));
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', line => this._handleLine(line));
    try {
      await this._request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'fanghe-ai-assistant', version: '2.0.0' },
      }, 10000);
      this._notify('notifications/initialized', {});
      const listed = await this._request('tools/list', {}, 10000);
      this.tools = listed?.tools ?? [];
      this.ready = true;
      console.log(`[MCP] tools: ${this.tools.map(t => t.name).join(', ')}`);
    } catch (e) {
      this._failAll(e);
      proc.kill();
      if (this.proc === proc) {
        this.proc = null;
        this.ready = false;
      }
      throw e;
    }
  }

  _failAll(err) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  _handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.id == null) return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else p.resolve(msg.result);
  }

  _request(method, params = {}, timeoutMs = 10000) {
    if (!this.proc) throw new Error('MCP server 尚未啟動');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP 請求逾時：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', id, method, params }) + '\n');
    });
  }

  _notify(method, params = {}) {
    if (this.proc) this.proc.stdin.write(JSON.stringify({ jsonrpc:'2.0', method, params }) + '\n');
  }

  getOpenAITools() {
    return this.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description || '', parameters: t.inputSchema || {type:'object',properties:{}} }
    }));
  }

  async callTool(name, args = {}) {
    const result = await this._request('tools/call', { name, arguments: args });
    return (result?.content || []).filter(x => x?.type === 'text').map(x => x.text).join('\n') || JSON.stringify(result ?? {}, null, 2);
  }
}
