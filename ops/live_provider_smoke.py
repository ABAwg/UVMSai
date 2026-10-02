"""Optional paid smoke tests. Run from repository root; never invoked by normal pytest.

UVMS_LIVE_PROVIDER_TESTS=1 python ops/live_provider_smoke.py [--extended] [--vision] [--search] [--images] [--audio PATH]
Only generated test content and an explicitly supplied audio file leave this machine.
"""
import argparse
import io
import json
import os
from pathlib import Path
import statistics
import sys
import tempfile
import uuid


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for option in ('extended','vision','search','images'): parser.add_argument('--'+option,action='store_true')
    parser.add_argument('--audio',type=Path)
    args=parser.parse_args()
    if os.environ.get('UVMS_LIVE_PROVIDER_TESTS')!='1':
        print('SKIPPED: set UVMS_LIVE_PROVIDER_TESTS=1 to allow paid live requests.');return 0
    root=Path(__file__).resolve().parents[1]
    sys.path.insert(0,str(root/'services/api'))
    temporary=Path(tempfile.mkdtemp(prefix='uvms-live-smoke-'))
    os.environ['UVMS_DATABASE_URL']='sqlite:///'+(temporary/'live.db').as_posix()
    os.environ['UVMS_STORAGE_DIR']=str(temporary/'storage')
    os.environ['UVMS_ENV']='development'
    from app.config import settings
    from app.ai_gateway import is_demo, provider_connection, ProviderError
    try:
        if is_demo(): raise ProviderError('configuration')
        provider_connection()
    except ProviderError:
        print('BLOCKED: configure the selected backend provider key and a live UVMS_AI_PROVIDER. No provider calls made.');return 2
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from app.main import app
    from app.database import SessionLocal
    from app.models import User,Subscription,UsageEvent
    results=[]
    with TestClient(app) as client:
        pair=client.post('/api/v1/auth/register',json={'email':f'live-{uuid.uuid4().hex}@example.com','password':uuid.uuid4().hex,'display_name':'Live QA'}).json()
        headers={'Authorization':'Bearer '+pair['access_token']}
        uid=pair['user']['id']
        with SessionLocal() as db:
            db.get(User,uid).role='admin'
            db.scalar(select(Subscription).where(Subscription.user_id==uid)).plan_code='plus';db.commit()
        def post(label,path,**kwargs):
            response=client.post('/api/v1'+path,headers=headers,**kwargs)
            passed=response.is_success
            body=response.json() if 'application/json' in response.headers.get('content-type','') else {}
            if body.get('demo') or body.get('meta',{}).get('demo'): passed=False
            if path=='/chat/stream': passed=passed and 'event: error' not in response.text and 'event: done' in response.text and response.text.count('event: delta')>1
            results.append({'case':label,'status':'pass' if passed else 'fail','http_status':response.status_code})
            print(label,results[-1]['status'],response.status_code)
            return response,body
        for model in ('uvms-1-fast','uvms-1-balanced','uvms-1-deep'):
            post(model+' streaming','/chat/stream',json={'model_id':model,'content':'Reply briefly in English, Russian and Uzbek with a greeting in each language.'})
        if args.extended:
            response,body=post('Markdown and code','/chat/complete',json={'content':'Give a short Markdown heading and a Python code block that prints hello.'})
            if response.is_success:
                chat_id=body['chat_id']
                post('multi-turn','/chat/complete',json={'chat_id':chat_id,'content':'Which language did that code use? Reply with one word.'})
                messages=client.get('/api/v1/chats/'+chat_id,headers=headers).json()['messages']
                post('regenerate','/chats/'+chat_id+'/messages/'+messages[-1]['id']+'/regenerate',json={})
                post('edit and regenerate','/chats/'+chat_id+'/messages/'+messages[0]['id']+'/edit',json={'content':'Give a short JavaScript code block instead.'})
            post('long Cyrillic input','/chat/complete',json={'content':('Это тестовый документ. '*300)+'\nSummarize it in one short sentence.'})
            _,project=post('project creation','/projects',json={'name':'Live context QA','instructions':'Begin answers with QA_PROJECT.'})
            post('enabled memory','/memory',json={'content':'When testing QA, prefer metric units.'})
            _,asset=post('document upload','/files',files={'upload':('qa.txt',b'Test project launch code: ORCHID-42.','text/plain')})
            if 'id' in project and 'id' in asset:
                _,answer=post('project, memory and document context','/chat/complete',json={'project_id':project['id'],'attachment_ids':[asset['id']],'content':'State the project launch code and my preferred measurement system.'})
                if answer.get('answer'):
                    results.append({'case':'context markers observed','status':'pass' if 'QA_PROJECT' in answer['answer'] and 'ORCHID-42' in answer['answer'] and 'metric' in answer['answer'].lower() else 'needs_manual_review'})
        if args.vision:
            from PIL import Image
            ids=[]
            for format,extension in [('PNG','png'),('JPEG','jpg'),('WEBP','webp')]:
                output=io.BytesIO();Image.new('RGB',(32,32),(240,0,0)).save(output,format=format)
                _,asset=post('vision '+format+' upload','/files',files={'upload':('red.'+extension,output.getvalue(),'image/'+extension)})
                if 'id' in asset: ids.append(asset['id'])
            post('multiple image understanding','/chat/complete',json={'content':'What color is shared by these images? Reply with one word.','attachment_ids':ids})
        if args.search:
            _,answer=post('native web search','/chat/complete',json={'content':'Search for the official Python documentation and cite its URL. One sentence.','web_search':True})
            results.append({'case':'live citations observed','status':'pass' if answer.get('meta',{}).get('citations') else 'not_observed'})
        if args.images:
            response,body=post('image generation','/images/generate',json={'prompt':'A small red circle on a plain white background.','size':'1024x1024','quality':'low'})
            if response.is_success:
                download=client.get('/api/v1/files/'+body['asset']['id']+'/download',headers=headers)
                chat=client.get('/api/v1/chats/'+body['chat_id'],headers=headers)
                results.append({'case':'image persistence and private download','status':'pass' if download.is_success and len(download.content)>100 and chat.is_success else 'fail'})
        if args.audio:
            with args.audio.open('rb') as audio:
                post('user-supplied recorded audio transcription','/audio/transcribe',files={'audio':(args.audio.name,audio)})
        with SessionLocal() as db:
            usage=[row.meta for row in db.scalars(select(UsageEvent).where(UsageEvent.user_id==uid,UsageEvent.kind=='provider.request')).all()]
        latencies=[row['first_token_ms'] for row in usage if row.get('first_token_ms') is not None]
        report={'results':results,'provider_usage':usage,'average_first_token_ms':statistics.mean(latencies) if latencies else None,'real_microphone_exercised':False,'audio_file_supplied':bool(args.audio),'note':'API TestClient drives the UVMS gateway; first-token timings are gateway observations. This is not browser microphone or perceptual quality certification.'}
        target=root/'.qa/live-provider-results.json';target.parent.mkdir(exist_ok=True);target.write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('Report:',str(target))
    return 1 if any(row['status']=='fail' for row in results) else 0


if __name__=='__main__':
    raise SystemExit(main())
