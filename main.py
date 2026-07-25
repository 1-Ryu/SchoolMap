# main.py
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
import os

app = FastAPI()

@app.get("/", response_class=HTMLResponse)
async def read_root():
    # templates 폴더 안의 index.html 파일을 읽어서 화면에 뿌려줍니다.
    file_path = os.path.join("templates", "index.html")
    with open(file_path, "r", encoding="utf-8") as f:
        html_content = f.read()
    return html_content