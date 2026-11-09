#!/usr/bin/env python3
"""Standard-library MCP server for Fanghe official school information."""
from __future__ import annotations
import json, re, sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
INDEX = BASE / "data" / "fanghe_official_index.json"
HOME = "https://www.fhehs.tp.edu.tw/"
TOPICS = [
    ("行事曆", ("行事曆", "行事历", "校務行程", "行程"), ("行事曆", "學校行事曆")),
    ("公告", ("公告", "最新消息", "近期消息"), ("重要公告", "最新消息", "校園公告")),
    ("新生入學", ("新生", "入學", "招生"), ("新生入學", "入學資訊", "新生入學專區")),
    ("升學資訊", ("升學", "升學進路", "招生資訊"), ("升學新訊", "升學進路資訊")),
    ("學生資源", ("學生專區", "學生資源", "學習資源"), ("學生專區", "學習資源中心")),
    ("課程活動", ("課程發展", "課程活動", "課程中心"), ("課程發展中心", "課程發展中心活動")),
    ("校園活動", ("校園活動", "活動消息", "活動花絮", "外展探索"), ("活動花絮", "外展探索中心活動")),
    ("行政單位", ("行政單位", "處室", "中心"), ("行政單位", "中心", "室")),
    ("學校簡介", ("學校特色", "學校簡介", "芳和簡介", "認識學校"), ("芳和簡介", "實驗教育")),
    ("分機", ("分機", "電話", "總機"), ("分機", "電話")),
    ("學生手冊", ("學生手冊", "手冊"), ("學生手冊",)),
    ("請假", ("請假", "假單", "公假", "病假", "事假"), ("請假", "學生手冊")),
    ("行動載具", ("行動載具", "手機", "載具"), ("行動載具", "手機", "學生手冊")),
    ("獎懲", ("獎懲", "嘉獎", "小功", "大功", "警告", "小過", "大過"), ("獎懲", "學生手冊")),
]
STOP_PHRASES = (
    "請問", "想請問", "我想知道", "我想問", "幫我查", "請幫我", "可以幫我", "可以請問",
    "有哪些", "有什麼", "最近", "目前", "現在", "學校", "校園", "學生", "芳和實中",
    "這學期", "本學期", "要去哪裡看", "在哪裡看", "請告訴我", "簡單介紹一下",
    "可以", "請問一下", "一下", "嗎", "呢", "的", "要", "怎麼", "如何",
)
TOOL = {"name":"search_school_info", "description":"查詢臺北市芳和實驗中學官方網站索引中的校務資料；只回傳有來源支持的內容。", "inputSchema":{"type":"object","properties":{"query":{"type":"string","description":"使用者的自然語言校務問題"}},"required":["query"]}}

def compact(value):
    return re.sub(r"\s+", "", str(value or "")).lower()

def bigrams(value):
    runs = re.findall(r"[\u4e00-\u9fff]+", compact(value))
    return {run[i:i+2] for run in runs for i in range(max(0, len(run)-1))}

def load_records():
    if not INDEX.exists():
        return []
    return json.loads(INDEX.read_text(encoding="utf-8")).get("records", [])

def detect_intent(query):
    q = compact(query)
    for intent, terms, _ in TOPICS:
        if any(compact(term) in q for term in terms):
            return intent
    return None

def key_terms(query):
    q = str(query or "")
    for phrase in sorted(STOP_PHRASES, key=len, reverse=True):
        q = q.replace(phrase, " ")
    return sorted(set(re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z0-9]{2,}", q)), key=len, reverse=True)

def excerpt_near(text, terms, width=300):
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    if not text:
        return ""
    matches = [(text.find(term), len(term)) for term in terms if term and text.find(term) >= 0]
    pos = min(matches, key=lambda item: (item[0], -item[1]))[0] if matches else 0
    start = max(0, pos - 90)
    return text[start:start+width]

def search_school_info(query):
    query = str(query or "").strip()
    if not query:
        return {"查詢":"", "結果":[], "錯誤":"請輸入查詢內容。", "官方首頁":HOME}
    records = load_records()
    q, query_pairs = compact(query), bigrams(query)
    intent = detect_intent(query)
    preferred = next((prefs for name, _, prefs in TOPICS if name == intent), ())
    terms = key_terms(query)
    scored = []
    for record in records:
        title = str(record.get("title", ""))
        text = str(record.get("text", ""))
        compact_title = compact(title)
        hay = compact(title + " " + text)
        score = 0
        for term in preferred:
            ct = compact(term)
            if ct and ct in compact_title: score += 100
            elif ct and ct in hay: score += 12
        score += 2 * len(query_pairs & bigrams(hay))
        for term in terms:
            ct = compact(term)
            if ct in compact_title: score += 50
            elif ct in hay: score += 10
        if intent and not any(compact(term) in hay for term in (*preferred, *terms)):
            continue
        url = str(record.get("url", ""))
        if url.rstrip("/") == HOME.rstrip("/"): score -= 100
        if "/category/" in url: score -= 35
        if record.get("type") == "pdf" and len(str(record.get("text", ""))) < 25: score -= 10
        if score > 8: scored.append((score, record))
    scored.sort(key=lambda item: item[0], reverse=True)
    results, seen = [], set()
    excerpt_terms = list(preferred) + terms
    for score, record in scored:
        url = str(record.get("url", ""))
        if not url or url in seen: continue
        seen.add(url)
        excerpt = excerpt_near(record.get("text", ""), excerpt_terms)
        results.append({"標題":record.get("title", ""), "原文摘錄":excerpt, "官方來源":url, "來源類型":record.get("type", "web"), "相關性":score})
        if len(results) == 1: break
    result = {"查詢":query, "學校":"臺北市芳和實驗中學", "查詢類型":intent or "一般校務", "結果":results, "官方首頁":HOME}
    if not results:
        result["錯誤"] = "目前芳和實中官方索引未找到足以支持此問題的資料；系統不自行補寫校規、電話或分機。"
    return result

def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()

def main():
    for line in sys.stdin:
        message = {}
        try:
            message = json.loads(line)
            method, mid = message.get("method"), message.get("id")
            params = message.get("params") or {}
            if method == "initialize" and mid is not None:
                send({"jsonrpc":"2.0", "id":mid, "result":{"protocolVersion":params.get("protocolVersion", "2025-06-18"), "capabilities":{"tools":{}}, "serverInfo":{"name":"fanghe-school", "version":"1.0.0"}}})
            elif method == "notifications/initialized":
                continue
            elif method == "tools/list" and mid is not None:
                send({"jsonrpc":"2.0", "id":mid, "result":{"tools":[TOOL]}})
            elif method == "tools/call" and mid is not None:
                if (params or {}).get("name") != TOOL["name"]: raise ValueError("未知工具")
                query = ((params or {}).get("arguments") or {}).get("query", "")
                text = json.dumps(search_school_info(query), ensure_ascii=False)
                send({"jsonrpc":"2.0", "id":mid, "result":{"content":[{"type":"text", "text":text}], "isError":False}})
            elif mid is not None:
                send({"jsonrpc":"2.0", "id":mid, "error":{"code":-32601, "message":"未知方法"}})
        except Exception as error:
            if "message" in locals() and message.get("id") is not None:
                send({"jsonrpc":"2.0", "id":message["id"], "error":{"code":-32000, "message":str(error)}})

if __name__ == "__main__":
    main()
