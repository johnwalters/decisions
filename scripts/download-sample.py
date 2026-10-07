"""Download a fixed, reproducible 100-image sample from public Kaggle version 1."""
import concurrent.futures, io, json, pathlib, urllib.parse, urllib.request, zipfile
ROOT = pathlib.Path(__file__).resolve().parents[1]
BASE = 'https://www.kaggle.com/api/v1/datasets/download/muhammad0subhan/fruit-and-vegetable-disease-healthy-vs-rotten'
def download(item):
    source=item['sourcePath']; dest=ROOT/'public/samples'/ (item['id']+pathlib.Path(source).suffix.lower())
    if not dest.exists():
        url=BASE+'?'+urllib.parse.urlencode({'dataset_version_number':1,'file_name':source})
        with urllib.request.urlopen(url,timeout=60) as response:raw=response.read()
        if raw[:2]==b'PK':
            with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                names=[x for x in archive.namelist() if x.lower().endswith(('.jpg','.jpeg','.png'))]
                if len(names)!=1:raise ValueError('Expected one image')
                raw=archive.read(names[0])
        if not (raw[:2]==b'\xff\xd8' or raw[:8]==b'\x89PNG\r\n\x1a\n'):raise ValueError('Response is not JPEG or PNG')
        dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(raw)
    return {**item,'src':f'/samples/{dest.name}','name':f"Apple {item['id'].split('-')[-1]}"}
items=json.loads((ROOT/'scripts/sample-sources.json').read_text());results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    futures={pool.submit(download,item):item for item in items}
    for future in concurrent.futures.as_completed(futures):
        try:results.append(future.result())
        except Exception as e:print(f"Failed {futures[future]['id']}: {e}",flush=True)
results.sort(key=lambda x:(x['name'],x['label']))
if len(results)!=100:raise SystemExit(f'Only {len(results)} images downloaded; manifest not replaced.')
(ROOT/'public/samples/manifest.json').write_text(json.dumps(results,indent=2))
print(f'Downloaded {len(results)} verified images.',flush=True)
