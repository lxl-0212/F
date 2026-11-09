#!/usr/bin/env python3
from __future__ import annotations
import json, re, time
from pathlib import Path
from urllib.parse import urljoin, urlparse
import requests
from bs4 import BeautifulSoup

BASE_URL = "https://www.fhehs.tp.edu.tw/"
OUT = Path(__file__).resolve().parents[1] / "data" / "fanghe_official_index.json"
OUT.parent.mkdir(parents=True, exist_ok=True)

SEEDS = [
    BASE_URL,
    urljoin(BASE_URL, "nss/p/index"),
]
KEYWORDS = ("分機","電話","學生手冊","請假","獎懲","手機","行動載具","法規","規定","行事曆",
            "教務","學務","生輔","輔導","實驗教育","校址")
session = requests.Session()
session.headers.update({"User-Agent":"Mozilla/5.0 FHJH-Mini-AI-Assistant/1.0"})

def clean_text(s):
    return re.sub(r"\s+", " ", s or "").strip()

def same_site(url):
    try:
        return urlparse(url).netloc.endswith("fhehs.tp.edu.tw")
    except Exception:
        return False

def fetch_html(url):
    r = session.get(url, timeout=20)
    r.raise_for_status()
    ctype = r.headers.get("content-type","").lower()
    if "html" not in ctype:
        return None, r
    r.encoding = r.apparent_encoding or r.encoding
    return BeautifulSoup(r.text, "html.parser"), r

def html_record(url, soup):
    title = clean_text(soup.title.get_text(" ", strip=True) if soup.title else url)
    for x in soup(["script","style","noscript"]):
        x.decompose()
    text = clean_text(soup.get_text(" ", strip=True))
    return {"title":title, "text":text[:120000], "url":url, "type":"web"}

def main():
    queue = list(SEEDS)
    seen, records = set(), []
    max_pages = 80

    while queue and len(seen) < max_pages:
        url = queue.pop(0)
        if url in seen or not same_site(url):
            continue
        seen.add(url)
        try:
            soup, resp = fetch_html(url)
            if soup is None:
                continue
            rec = html_record(url, soup)
            hay = rec["title"] + " " + rec["text"]
            if url == BASE_URL or any(k in hay for k in KEYWORDS):
                records.append(rec)

            for a in soup.find_all("a", href=True):
                href = urljoin(url, a["href"]).split("#")[0]
                label = clean_text(a.get_text(" ", strip=True))
                if not same_site(href):
                    continue
                if href.lower().endswith((".jpg",".jpeg",".png",".gif",".zip",".rar",".7z",".mp4",".mp3")):
                    continue
                if href.lower().endswith(".pdf"):
                    # PDF 保留為官方來源紀錄；不在同步階段硬做 OCR。
                    records.append({
                        "title": label or Path(urlparse(href).path).name or "官方 PDF",
                        "text": label,
                        "url": href,
                        "type": "pdf"
                    })
                elif href not in seen and (any(k in label for k in KEYWORDS) or len(seen) < 25):
                    queue.append(href)
        except Exception as e:
            print("WARN", url, type(e).__name__, str(e)[:160])
        time.sleep(0.05)

    # URL 去重
    unique = {}
    for r in records:
        if r.get("url"):
            unique[r["url"]] = r
    records = list(unique.values())

    data = {
        "school": "臺北市芳和實驗中學",
        "official_home": BASE_URL,
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "records": records,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("官方首頁:", BASE_URL)
    print("索引輸出:", OUT)
    print("總筆數:", len(records))
    for kw in ["分機","請假","學生手冊","獎懲","行事曆","手機","行動載具"]:
        hits = [r for r in records if kw in (r.get("title","")+r.get("text",""))]
        print(f"{kw}: {len(hits)}")
    if not records:
        raise RuntimeError("官方網站同步完成但索引為 0 筆，請檢查網站連線。")

if __name__ == "__main__":
    main()
