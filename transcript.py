from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from google.cloud import speech
import base64
import logging
import os
import uvicorn
import websocket
import json
import threading
import asyncio
import time

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 创建FastAPI应用
app = FastAPI(title="Google Speech-to-Text Streaming API")

# 配置CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生产环境中应该限制为特定域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

YOUR_API_KEY = ""

# 设置Google Cloud认证
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = '/Users/xx/.config/gcloud/application_default_credentials.json'

# 请求模型 - 接收base64音频数据
class AudioData(BaseModel):
    audio_data: str  # base64编码的音频数据
    language_code: Optional[str] = "en-US"  # 默认英语
    sample_rate: Optional[int] = 16000
    source: str

# Declare these as global variables
question = ""
answer = ""

def on_open(ws):
    print("")

def on_message(ws, message):
    global answer  # Declare as global
    try:
        msg = json.loads(message)
        msg_type = msg.get('message_type')

        if msg_type == 'SessionBegins':
            session_id = msg.get('session_id')
            print("Session ID:", session_id)
            return

        text = msg.get('text', '')
        if not text:
            return

        if msg_type == 'PartialTranscript':
            # print(text, end='\r')
            pass
        elif msg_type == 'FinalTranscript':
            # print(text, end='\r\n')
            logger.info(f"msg: {text}")
            answer += text
        elif msg_type == 'error':
            print(f'\nError: {msg.get("error", "Unknown error")}')
    except Exception as e:
        print(f'\nError handling message: {e}')

def on_message_q(ws, message):
    global question  # Declare as global
    try:
        msg = json.loads(message)
        msg_type = msg.get('message_type')

        if msg_type == 'SessionBegins':
            session_id = msg.get('session_id')
            print("Session ID:", session_id)
            return

        text = msg.get('text', '')
        if not text:
            return

        if msg_type == 'PartialTranscript':
            # print(text, end='\r')
            pass
        elif msg_type == 'FinalTranscript':
            # print(text, end='\r\n')
            logger.info(f"msg: {text}")
            question += text
        elif msg_type == 'error':
            print(f'\nError: {msg.get("error", "Unknown error")}')
    except Exception as e:
        print(f'\nError handling message: {e}')

def on_error(ws, error):
    print(f'\nError: {error}')

def on_close(ws, status, msg):
    print('\nDisconnected')

FRAMES_PER_BUFFER = 3200  # 200ms of audio (0.2s * 16000Hz)
SAMPLE_RATE = 16000       # 16kHz sample rate
CHANNELS = 1              # Mono audio

ws = websocket.WebSocketApp(
    f'wss://api.assemblyai.com/v2/realtime/ws?sample_rate={SAMPLE_RATE}',
    header={'Authorization': YOUR_API_KEY},
    on_message=on_message,
    on_open=on_open,
    on_error=on_error,
    on_close=on_close
)

ws_q = websocket.WebSocketApp(
    f'wss://api.assemblyai.com/v2/realtime/ws?sample_rate={SAMPLE_RATE}',
    header={'Authorization': YOUR_API_KEY},
    on_message=on_message_q,
    on_open=on_open,
    on_error=on_error,
    on_close=on_close
)

# 响应模型
class TranscriptionResult(BaseModel):
    q_text: str
    a_text: str
    is_final: bool = False
    error: Optional[str] = None

@app.post("/transcribe", response_model=TranscriptionResult)
async def transcribe_audio(audio_data: AudioData):
    try:
        audio_content = base64.b64decode(audio_data.audio_data)
        if audio_data.source == "q":
            ws_q.send(audio_content, websocket.ABNF.OPCODE_BINARY)
        else:
            ws.send(audio_content, websocket.ABNF.OPCODE_BINARY)
        return TranscriptionResult(
            q_text="transcribed_text",
            a_text="transcribed_text_a",
            is_final=True
        )
        
    except Exception as e:
        logger.error(f"流式识别失败: {e}", exc_info=True)
        # 返回错误信息
        return TranscriptionResult(q_text="", a_text="", is_final=False, error=str(e))
    
@app.post("/get_transcribe", response_model=TranscriptionResult)
async def get_transcribe():
    global question, answer  # Declare as global
    start_time = time.time()
    while not answer and time.time() - start_time < 3:
        await asyncio.sleep(0.5)
    cur_q = question
    cur_a = answer
    question = ""
    answer = ""
    return TranscriptionResult(
        q_text=cur_q,
        a_text=cur_a,
        is_final=True
    ) 

# 添加一个健康检查端点
@app.get("/health")
async def health_check():
    return {"status": "ok"}

def start_ws():
    ws.run_forever()

def start_ws_q():
    ws_q.run_forever()

if __name__ == "__main__":
    threading.Thread(target=start_ws, daemon=True).start()
    threading.Thread(target=start_ws_q, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)