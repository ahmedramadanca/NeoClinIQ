#!/usr/bin/env python3
"""Private NeoClinIQ reference ingestion. Run only in a trusted environment.

Required environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_ACCESS_TOKEN.
Google token must have read permission on the source files. Never commit secrets.
Dependencies: pip install requests pymupdf
"""
import os, sys, time, random, argparse, concurrent.futures
import requests
import fitz

URL=os.environ["SUPABASE_URL"].rstrip("/")
KEY=os.environ["SUPABASE_SERVICE_ROLE_KEY"]
TOKEN=os.environ["GOOGLE_ACCESS_TOKEN"]
HEAD={"apikey":KEY,"Authorization":"Bearer "+KEY}
SESSION=requests.Session()

def request(method,url,**kw):
    for attempt in range(6):
        try:
            r=requests.request(method,url,timeout=120,**kw)
            if r.status_code in (429,500,502,503,504):
                time.sleep(min(45,2**attempt+random.random()))
                continue
            r.raise_for_status()
            return r
        except (requests.Timeout,requests.ConnectionError):
            if attempt==5: raise
            time.sleep(min(45,2**attempt+random.random()))
    raise RuntimeError("retry budget exhausted")

def db(method,path,**kw):
    return request(method,URL+"/rest/v1/"+path,headers={**HEAD,**kw.pop("headers",{})},**kw)

def pending():
    offset=0
    while True:
        batch=db("GET","original_reference_documents",params={
          "select":"id,drive_file_id,title,mime_type",
          "indexing_status":"eq.pending","order":"created_at.asc",
          "limit":100,"offset":offset}).json()
        if not batch: return
        yield from batch
        offset+=len(batch)

def chunks(text,max_chars=1800,overlap=180):
    text=" ".join(text.split())
    start=0
    while start<len(text):
        end=min(start+max_chars,len(text))
        if end<len(text):
            boundary=text.rfind(" ",start+max_chars//2,end)
            if boundary>start: end=boundary
        yield text[start:end]
        if end==len(text): break
        start=max(start+1,end-overlap)

def process(doc):
    ident=doc["id"]
    file_id=doc.get("drive_file_id")
    if not file_id: return ident,"missing Drive file ID"
    try:
        media=request("GET",f"https://www.googleapis.com/drive/v3/files/{file_id}",
          params={"alt":"media"},headers={"Authorization":"Bearer "+TOKEN}).content
        pdf=fitz.open(stream=media,filetype="pdf")
        rows=[]
        for page in pdf:
            for passage in chunks(page.get_text("text")):
                rows.append({"document_id":ident,"passage_number":len(rows)+1,
                             "passage_text":f"[Page {page.number+1}] {passage}"})
        pdf.close()
        if not rows: return ident,"no extractable text; requires OCR"
        # Only pending documents are processed. Write passages before marking indexed.
        # Delete any partial passages from an earlier interrupted attempt.
        db("DELETE","original_reference_passages",params={"document_id":"eq."+ident})
        for i in range(0,len(rows),100):
            db("POST","original_reference_passages",json=rows[i:i+100],
               headers={"Content-Type":"application/json","Prefer":"return=minimal"})
        db("PATCH","original_reference_documents",params={"id":"eq."+ident},
           json={"indexing_status":"indexed","indexed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())},
           headers={"Content-Type":"application/json","Prefer":"return=minimal"})
        return ident,f"indexed {len(rows)} passages"
    except Exception as exc:
        return ident,f"ERROR {type(exc).__name__}: {str(exc)[:250]}"

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--workers",type=int,default=12)
    p.add_argument("--limit",type=int,default=0,help="0 means all pending")
    args=p.parse_args()
    docs=list(pending())
    if args.limit: docs=docs[:args.limit]
    print(f"Processing {len(docs)} pending documents with {args.workers} workers",flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for i,(ident,status) in enumerate(pool.map(process,docs),1):
            print(f"{i}/{len(docs)} {ident}: {status}",flush=True)
if __name__=="__main__": main()
