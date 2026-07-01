#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, html, time, hashlib, sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / 'data'
COM_URL = os.getenv('COM_ACTIVITIES_URL', 'https://cabinet.iq/ar/category/activities')
MAX_PAGES = int(os.getenv('COM_MAX_PAGES', '7'))
MAX_SECTIONS = int(os.getenv('COM_MAX_SECTIONS_PER_PAGE', '25'))
OPENAI_API_KEY = re.sub(r'\s+', '', os.getenv('OPENAI_API_KEY', ''))
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4o-mini')

PRIORITY_TERMS = ['إعمار','اعمار','مشروع','مشاريع','استثمار','سكن','إسكان','اسكان','بنى تحتية','البنى التحتية','طرق','جسور','مجاري','صرف صحي','وزارة الإعمار','وزارة التخطيط','الهيئة الوطنية للاستثمار','هيئة الاستثمار','عقد','إحالة','احالة','تنفيذ','تمويل','المدن السكنية','السكني','السكنية']
HEADING_PREFIXES = ('وزارة ', 'هيئة ', 'الهيئة ', 'الأمانة ', 'الامانة ', 'محافظة ', 'جهاز ', 'ديوان ', 'مجلس ', 'البنك ', 'مصرف ', 'المفوضية ')


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def clean(s):
    if not s: return ''
    s = html.unescape(str(s))
    s = re.sub(r'<!\[CDATA\[(.*?)\]\]>', r'\1', s, flags=re.S)
    s = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', s, flags=re.S|re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def ar_digits(s):
    return str(s or '').translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))


def parse_date(text):
    raw = ar_digits(clean(text))
    m = re.search(r'(\d{1,2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(20\d{2})', raw)
    if m:
        d, mo, y = map(int, m.groups())
        try: return datetime(y, mo, d, tzinfo=timezone.utc).astimezone().isoformat(timespec='seconds')
        except Exception: pass
    months = {'كانون الثاني':1,'يناير':1,'شباط':2,'فبراير':2,'آذار':3,'اذار':3,'مارس':3,'نيسان':4,'ابريل':4,'أبريل':4,'أيار':5,'ايار':5,'مايو':5,'حزيران':6,'يونيو':6,'تموز':7,'يوليو':7,'آب':8,'اب':8,'أغسطس':8,'أيلول':9,'ايلول':9,'سبتمبر':9,'تشرين الأول':10,'تشرين الاول':10,'أكتوبر':10,'تشرين الثاني':11,'نوفمبر':11,'كانون الأول':12,'كانون الاول':12,'ديسمبر':12}
    for name, mo in months.items():
        m = re.search(rf'(\d{{1,2}})\s+{re.escape(name)}\s+(20\d{{2}})', raw)
        if m:
            d, y = int(m.group(1)), int(m.group(2))
            try: return datetime(y, mo, d, tzinfo=timezone.utc).astimezone().isoformat(timespec='seconds')
            except Exception: pass
    return now_iso()


def render(url):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=['--no-sandbox'])
        page = browser.new_page(locale='ar-IQ', viewport={'width': 1365, 'height': 2200})
        try:
            page.goto(url, wait_until='networkidle', timeout=70000)
        except Exception:
            page.goto(url, wait_until='domcontentloaded', timeout=70000)
        page.wait_for_timeout(3000)
        html_text = page.content()
        body_text = page.locator('body').inner_text(timeout=20000)
        links = page.eval_on_selector_all('a', """els => els.map(a => ({text:(a.innerText||a.textContent||'').trim(), href:a.href||''}))""")
        browser.close()
        return html_text, body_text, links


def is_detail_link(link):
    href = str(link.get('href') or '').strip()
    text = clean(link.get('text') or '')
    if not href or '/ar/category/' not in href: return False
    if href.rstrip('/') == COM_URL.rstrip('/'): return False
    blob = href + ' ' + text
    if any(x in blob for x in ['النشاطات','الحكومية','الفعاليات']): return True
    if re.search(r'(20\d{2})|(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*20\d{2})', ar_digits(blob)): return True
    if re.search(r'/ar/category/[^/]+/[^/]+/?$', href): return True
    return False


def clean_lines(text):
    skip = ['الرئيسية','اتصل بنا','خريطة الموقع','حقوق النشر','بحث','القائمة','facebook','twitter','youtube','instagram','تسجيل الدخول']
    out, seen = [], set()
    for line in str(text or '').splitlines():
        line = clean(line)
        if len(line) < 3: continue
        low = line.lower()
        if any(w in low for w in skip): continue
        key = re.sub(r'\s+', ' ', low).strip()
        if key in seen: continue
        seen.add(key); out.append(line)
    return out


def is_heading(line):
    line = clean(line)
    if not line or len(line) > 150: return False
    if not any(line.startswith(p) for p in HEADING_PREFIXES): return False
    return line not in {'مجلس الوزراء','الامانة العامة لمجلس الوزراء','الأمانة العامة لمجلس الوزراء'}


def hits(text):
    low = str(text or '').lower()
    return sorted({t for t in PRIORITY_TERMS if t.lower() in low})


def score(text):
    return max(1, min(100, 50 + 5*len(hits(text))))


def split_sections(body):
    lines = clean_lines(body)
    sections, cur = [], None
    for line in lines:
        if is_heading(line):
            if cur and clean(cur['raw_ar']): sections.append(cur)
            cur = {'ministry_ar': line, 'raw_ar': ''}
            continue
        if cur: cur['raw_ar'] += line + '\n'
    if cur and clean(cur['raw_ar']): sections.append(cur)
    if not sections:
        body2 = '\n'.join(lines)
        if clean(body2): sections = [{'ministry_ar':'مجلس الوزراء', 'raw_ar':body2[:5000]}]
    cleaned = []
    for s in sections[:MAX_SECTIONS]:
        raw = clean(s.get('raw_ar',''))
        if len(raw) < 25: continue
        s['raw_ar'] = raw[:3000]
        s['raw_chars'] = len(raw)
        s['priority_score'] = score(s['ministry_ar'] + ' ' + raw)
        s['keyword_hits'] = hits(s['ministry_ar'] + ' ' + raw)
        s['ministry_ko'] = s['ministry_ar']
        s['summary_ko'] = raw[:350]
        s['category'] = '정부활동'
        cleaned.append(s)
    return cleaned


def post_json(url, payload, headers, timeout=120):
    import urllib.request
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={'Content-Type':'application/json', **headers}, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode('utf-8'))


def summarize(title, published, sections):
    if not OPENAI_API_KEY or not sections:
        return ('OpenAI API Key가 없어 아랍어 원문 일부를 표시합니다.', sections)
    compact = [{'no':i+1, 'ministry_ar':s['ministry_ar'][:180], 'raw_ar':s['raw_ar'][:1800]} for i,s in enumerate(sections)]
    prompt = {'task':'이라크 내각 사무처 일일 주요활동을 부처별 한국어로 요약', 'rules':['summary_ko는 한국어 1~2문장','건설/투자/주택/인프라/NIC는 우선도 높게','JSON object만 출력'], 'page_title_ar':title, 'published_date':published, 'sections':compact, 'return_format':{'day_summary_ko':'한국어 2~3줄 요약','ministries':[{'no':1,'ministry_ko':'한국어 부처명','summary_ko':'요약','category':'건설/인프라','priority_score':80}]}}
    try:
        res = post_json('https://api.openai.com/v1/chat/completions', {'model':OPENAI_MODEL, 'messages':[{'role':'system','content':'You summarize Iraqi Arabic government activity reports by ministry in Korean. Return only valid JSON.'},{'role':'user','content':json.dumps(prompt, ensure_ascii=False)}], 'response_format':{'type':'json_object'}}, headers={'Authorization':f'Bearer {OPENAI_API_KEY}'})
        data = json.loads(res['choices'][0]['message']['content'])
        by_no = {int(x.get('no')):x for x in data.get('ministries', []) if str(x.get('no','')).isdigit()}
        enriched = []
        for i,s in enumerate(sections, start=1):
            item = dict(s); ai = by_no.get(i,{})
            item['ministry_ko'] = clean(ai.get('ministry_ko') or item['ministry_ar'])
            item['summary_ko'] = clean(ai.get('summary_ko') or item['summary_ko'])[:700]
            item['category'] = clean(ai.get('category') or item['category'])
            try: item['priority_score'] = max(1, min(100, int(ai.get('priority_score') or item['priority_score'])))
            except Exception: pass
            enriched.append(item)
        return (clean(data.get('day_summary_ko') or ''), enriched)
    except Exception as e:
        print('WARNING: OpenAI summary failed:', e, file=sys.stderr)
        return ('COM 주요활동 자동 요약 중 오류가 발생해 원문 일부를 표시합니다.', sections)


def make_id(title, url):
    return hashlib.sha1(('com|' + title + '|' + url).encode('utf-8')).hexdigest()[:16]


def collect_one(detail):
    url, hint = detail['url'], detail.get('title') or 'النشاطات الحكومية'
    print('COM detail:', hint, url)
    _, body, _ = render(url)
    lines = clean_lines(body)
    if not lines:
        return {'url':url, 'title_hint':hint, 'warning':'no_lines', 'sections':[]}
    title = hint
    for line in lines[:10]:
        if 'النشاطات' in line or 'الحكومية' in line or re.search(r'20\d{2}', ar_digits(line)):
            title = line; break
    published = parse_date(title + ' ' + hint + ' ' + ' '.join(lines[:8]))
    sections = split_sections(body)
    day_summary, ministries = summarize(title, published, sections)
    total_priority = max([int(m.get('priority_score',50)) for m in ministries] or [50])
    article = {'id':make_id(title,url), 'date_found':now_iso(), 'published_date':published, 'source':'الأمانة العامة لمجلس الوزراء', 'title_original':title, 'title_ko':'COM 주요활동: ' + published[:10], 'summary_ko':day_summary or f'{len(ministries)}개 부처 주요활동 수집', 'url':url, 'language':'ar', 'country':'Iraq', 'organization':'Council of Ministers', 'keywords':['COM','이라크 내각','정부활동'], 'importance_score':total_priority, 'category':'정부/정책', 'source_country':'Iraq', 'collection_method':'com_activities_detail_debug', 'segment':'com', 'ministries':ministries}
    return {'url':url, 'title_hint':hint, 'page_title':title, 'published_date':published, 'body_text_length':len(body or ''), 'line_count':len(lines), 'section_count':len(sections), 'sections':sections, 'article':article}


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    print('COM category:', COM_URL)
    _, body, links = render(COM_URL)
    details, seen = [], set()
    for link in links:
        if not is_detail_link(link): continue
        href = str(link.get('href') or '').strip()
        if href in seen: continue
        seen.add(href)
        details.append({'title':clean(link.get('text') or '') or 'النشاطات الحكومية', 'url':href})
    details = details[:MAX_PAGES]
    pages, articles = [], []
    for d in details:
        try:
            r = collect_one(d); pages.append(r)
            if r.get('article'): articles.append(r['article'])
            time.sleep(.7)
        except Exception as e:
            print('WARNING detail failed:', d.get('url'), e, file=sys.stderr)
            pages.append({'url':d.get('url'), 'title_hint':d.get('title'), 'warning':str(e), 'sections':[]})
    debug = {'generated_at':now_iso(), 'source_url':COM_URL, 'openai_summary':bool(OPENAI_API_KEY), 'category_text_length':len(body or ''), 'raw_links_count':len(links), 'detail_links_count':len(details), 'detail_links':details, 'pages_count':len(pages), 'pages':pages}
    activities = {'generated_at':now_iso(), 'source_url':COM_URL, 'count':len(articles), 'articles':articles, 'sections':{'com':articles}}
    (DATA_DIR/'com-debug.json').write_text(json.dumps(debug, ensure_ascii=False, indent=2), encoding='utf-8')
    (DATA_DIR/'com-activities.json').write_text(json.dumps(activities, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'COM detail pages: {len(pages)} / articles: {len(articles)}')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
