# main.py
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
import os

app = FastAPI()

# 실제 배포는 Vercel이 templates/index.html을 정적 파일로 서빙한다.
# 이 서버는 로컬에서 확인할 때만 쓰이므로, 배포와 똑같은 파일을 그대로 내보낸다.
@app.get("/", response_class=HTMLResponse)
async def read_root():
    # templates 폴더 안의 index.html 파일을 읽어서 화면에 뿌려줍니다.
    file_path = os.path.join("templates", "index.html")
    with open(file_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    return html_content

# index.html이 app.js, style.css를 "/"에서, CSV를 "/data/..."에서 상대경로로 참조하므로
# 두 경로를 그대로 정적 파일로 서빙해준다.
app.mount("/data", StaticFiles(directory="data"), name="data")
app.mount("/", StaticFiles(directory="templates"), name="static")