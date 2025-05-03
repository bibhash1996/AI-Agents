from fastapi import APIRouter, UploadFile,File
from app import llm, vectorStore, embeddings
from langchain.prompts import PromptTemplate
from fastapi.responses import JSONResponse,StreamingResponse
from ..controller.chain import getAnswerUsingVectorResult,getAudioForTheText,transcribe
import io

router = APIRouter()

@router.get("/")
async def read_root():
    return {"message": f"Hello from FastAPI"}

@router.get('/ask')
async def ask(question:str):
    print(question)
    template = PromptTemplate.from_template(""" Answer the question asked by the user funningly.
                                            Question: {question}
                                            """)
    chain = template | llm
    response = chain.invoke({
        "question":question
    })
    print(response)
    data = {
        "question":question,
        "answer":response.content
    }
    return JSONResponse(content=data,status_code=200)


@router.get('/answers')
def getAnswer(question:str,session_id:str):
    # Creating question embedding
    text_response = getAnswerUsingVectorResult(session_id,question)
    print("Got text response")
    audio_stream_response = getAudioForTheText(text_response)
    # return JSONResponse(content={"message":textResponse},status_code=200)
    print("Got audio response")
    # return Response(audioResponse, media_type="audio/mpeg")
    return StreamingResponse(audio_stream_response,media_type="audio/wav")

@router.post("/transcribe")
async def upload_audio(audio: UploadFile = File(...)):
    # audio.filename, audio.content_type available
    # audio_blob = await audio.read() 
     # bytes of the audio file
    audio_bytes = await audio.read()
    file_like = io.BytesIO(audio_bytes)
    response = transcribe(audio_content=file_like)

    return JSONResponse(content={"response":response},status_code=200)


@router.post("/talk")
async def upload_audio(session_id:str,audio: UploadFile = File(...)):
    # audio.filename, audio.content_type available
    # audio_blob = await audio.read() 
     # bytes of the audio file
    audio_bytes = await audio.read()
    file_like = io.BytesIO(audio_bytes)
    question = transcribe(audio_content=file_like)
    text_response = getAnswerUsingVectorResult(session_id,question)
    print("Got text response")
    audio_stream_response = getAudioForTheText(text_response)
    # return JSONResponse(content={"message":textResponse},status_code=200)
    print("Got audio response")
    # return Response(audioResponse, media_type="audio/mpeg")
    return StreamingResponse(audio_stream_response,media_type="audio/wav")

    
    


