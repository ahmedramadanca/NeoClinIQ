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
db=create_client(required("SUPABASE_URL"),required("SUPABASE_SERVICE_ROLE_KEY"))
token_response=requests.post("https://oauth2.googleapis.com/token",data={
 "client_id":required("GOOGLE_CLIENT_ID"),
 "client_secret":required("GOOGLE_CLIENT_SECRET"),
 "refresh_token":required("GOOGLE_REFRESH_TOKEN"),
 "grant_type":"refresh_token"},timeout=30)
token_response.raise_for_status()
token=token_response.json()["access_token"]
session=requests.Session()
session.headers["Authorization"]="Bearer "+token

def save(id,number,text,words):
 db.table("osce_ocr_pages").upsert({"drive_file_id":id,"page_number":number,"page_text":text[:100000],"ocr_words":words[:10000]}).execute()

def process(item):
 id=item["drive_file_id"]
 existing=db.table("osce_ocr_pages").select("page_number").eq("drive_file_id",id).execute().data
 done={p["page_number"] for p in existing}
 for attempt in range(4):
  try:
   r=session.get("https://www.googleapis.com/drive/v3/files/"+id,params={"alt":"media"},timeout=180)
   if r.status_code==401: raise RuntimeError("Google access token expired; rerun job")
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
    save(id,n,text,words)
   print("INDEXED",id,len(doc),"pages",flush=True)
   return True
  except Exception as e:
   print("RETRY",id,attempt,str(e),flush=True)
   if attempt==3:return False
   time.sleep(2**attempt)
 return False

items=[]
offset=0
while True:
 rows=db.table("osce_drive_catalog").select("drive_file_id").eq("mime_type","application/pdf").range(offset,offset+99).execute().data
 items.extend(rows)
 if len(rows)<100:break
 offset+=100
print("SOURCE_PDFS",len(items),flush=True)
failed=[]
for i,item in enumerate(items,1):
 if not process(item):failed.append(item["drive_file_id"])
 print("PROGRESS",i,"/",len(items),"FAILED",len(failed),flush=True)
print("FAILED_IDS",failed,flush=True)
if failed:sys.exit(1)
