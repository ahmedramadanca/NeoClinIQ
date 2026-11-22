"""Resumable private Google Drive OSCE OCR -> Supabase page index."""
import os,sys,time,io
import requests,fitz,pytesseract
from PIL import Image
from supabase import create_client
from concurrent.futures import ThreadPoolExecutor

def required(k):
 v=os.getenv(k)
 if not v: raise RuntimeError("Missing required GitHub Actions secret: "+k)
 return v
SUPABASE_URL=required("SUPABASE_URL").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY=required("SUPABASE_SERVICE_ROLE_KEY")
EXPECTED_PROJECT_HOST="uxnqoglkqptnslsdowxn.supabase.co"
if SUPABASE_URL != "https://"+EXPECTED_PROJECT_HOST:
 raise RuntimeError("SUPABASE_URL secret must be https://"+EXPECTED_PROJECT_HOST+"; check GitHub Actions repository secrets.")
db=create_client(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY)
print("Supabase project host:", SUPABASE_URL.split("//",1)[-1],flush=True)
session=requests.Session()
def private_pdf_url(id):
 response=session.post(required("SUPABASE_URL").rstrip("/")+"/functions/v1/website-osce-drive",headers={"apikey":SUPABASE_SERVICE_ROLE_KEY,"Content-Type":"application/json"},json={"action":"worker-open","id":id},timeout=30)
 response.raise_for_status()
 return response.json()["url"]

def save(id,number,text,words):
 db.table("osce_ocr_pages").upsert({"drive_file_id":id,"page_number":number,"page_text":text[:100000],"ocr_words":words[:10000]}).execute()

def process(item):
 id=item["drive_file_id"]
 existing=db.table("osce_ocr_pages").select("page_number,page_text").eq("drive_file_id",id).execute().data
 done={p["page_number"] for p in existing if len((p.get("page_text") or "").strip())>=20}
 for attempt in range(4):
  try:
   r=session.get(private_pdf_url(id),timeout=180)
   r.raise_for_status()
   doc=fitz.open(stream=r.content,filetype="pdf")
   for idx,page in enumerate(doc):
    n=idx+1
    if n in done: continue
    text=page.get_text("text")
    words=[]
    if len(text.strip())<80:
     pix=page.get_pixmap(matrix=fitz.Matrix(2,2),alpha=False)
     image=Image.open(io.BytesIO(pix.tobytes("png")))
     ocr=pytesseract.image_to_data(image,output_type=pytesseract.Output.DICT,config="--psm 3")
     lines=[]
     for j,t in enumerate(ocr["text"]):
      t=t.strip()
      if not t: continue
      lines.append(t)
      words.append({"t":t,"x":ocr["left"][j]/pix.width,"y":ocr["top"][j]/pix.height,"w":ocr["width"][j]/pix.width,"h":ocr["height"][j]/pix.height})
     text=" ".join(lines)
    else:
     for w in page.get_text("words"):
      x0,y0,x1,y1,t,*_=w
      words.append({"t":t,"x":x0/page.rect.width,"y":y0/page.rect.height,"w":(x1-x0)/page.rect.width,"h":(y1-y0)/page.rect.height})
    if len(text.strip())<20:
     print("OCR_UNRESOLVED",id,n,"characters",len(text.strip()),flush=True)
     continue
    save(id,n,text,words)
   unresolved=[n for n in range(1,len(doc)+1) if n not in done and len((db.table("osce_ocr_pages").select("page_text").eq("drive_file_id",id).eq("page_number",n).execute().data or [{}])[0].get("page_text","").strip())<20]
   print("INDEXED",id,len(doc),"pages","UNRESOLVED",unresolved,flush=True)
   return not unresolved
  except Exception as e:
   print("RETRY",id,attempt,str(e),flush=True)
   if "401 Client Error" in str(e) or "403 Client Error" in str(e): raise RuntimeError("Private PDF authentication failed; stopping instead of retrying all 471 PDFs") from e
   if attempt==3:return False
   time.sleep(2**attempt)
 return False

# Retry existing low-text OCR records first.
priority=set()
page_offset=0
while True:
 rows=db.table("osce_ocr_pages").select("drive_file_id,page_text").range(page_offset,page_offset+499).execute().data
 for row in rows:
  if len((row.get("page_text") or "").strip())<20:
   priority.add(row["drive_file_id"])
 if len(rows)<500:break
 page_offset+=500
print("PRIORITY_PDFS",len(priority),flush=True)

items=[]
offset=0
while True:
 rows=db.table("osce_drive_catalog").select("drive_file_id").eq("mime_type","application/pdf").range(offset,offset+99).execute().data
 items.extend(rows)
 if len(rows)<100:break
 offset+=100
items.sort(key=lambda item:(item["drive_file_id"] not in priority,item["drive_file_id"]))
print("SOURCE_PDFS",len(items),flush=True)
print("PRIORITY_IDS",sorted(priority),flush=True)
failed=[]
for i,item in enumerate(items,1):
 if not process(item):failed.append(item["drive_file_id"])
 print("PROGRESS",i,"/",len(items),"FAILED",len(failed),flush=True)
print("FAILED_IDS",failed,flush=True)
if failed:sys.exit(1)
