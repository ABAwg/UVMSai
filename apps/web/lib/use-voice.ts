'use client';
import { useEffect, useRef, useState } from 'react';
import { apiFetch, errorMessage, jsonOrThrow } from './api';
import { toast } from './feedback';

export function useVoice(onTranscript: (text: string) => void, onError: (message: string) => void) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds,setSeconds] = useState(0);
  useEffect(()=>{if(!listening)return;setSeconds(0);const started=Date.now();const timer=setInterval(()=>setSeconds(Math.floor((Date.now()-started)/1000)),250);return()=>clearInterval(timer);},[listening]);
  const recorder = useRef<MediaRecorder | null>(null);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  const timeout = useRef<ReturnType<typeof setTimeout>>();
  function cancel() {
    cancelled.current = true;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    recorder.current?.stream.getTracks().forEach(track => track.stop());
    clearTimeout(timeout.current);
    setListening(false);
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(); }; }, []);
  async function toggle() {
    if (listening) { recorder.current?.stop(); return; }
    if (requesting || transcribing) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Recording is unavailable in this browser. Use a supported browser over HTTPS or localhost.'); return;
    }
    setRequesting(true); cancelled.current = false;
    let acquired: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      acquired = stream;
      if (!mounted.current || cancelled.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mimeType) { stream.getTracks().forEach(track=>track.stop());onError('This browser has no supported recording codec. Use WebM/Opus or MP4 audio.');return; }
      const current = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.current = current;
      const chunks: Blob[] = [];
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      current.onerror = () => { cancel(); onError('Recording stopped unexpectedly. Please try again.'); };
      current.onstop = async () => {
        clearTimeout(timeout.current); stream.getTracks().forEach(track => track.stop()); setListening(false);
        if (cancelled.current || !mounted.current) return;
        const blob = new Blob(chunks, { type: current.mimeType });
        if (!blob.size) { onError('No audio was recorded. Please try again.'); return; }
        if (blob.size > 25 * 1024 * 1024) { onError('Recording exceeds 25 MB. Please record a shorter message.'); return; }
        setTranscribing(true);
        try {
          const form = new FormData();
          const extension = current.mimeType.includes('mp4') ? 'm4a' : current.mimeType.includes('ogg') ? 'ogg' : 'webm';
          form.append('audio', blob, `recording.${extension}`);
          const result = await jsonOrThrow<{ text: string; demo: boolean }>(await apiFetch('/audio/transcribe', { method: 'POST', body: form }));
          if (!mounted.current || cancelled.current) return;
          if (result.demo) toast('Demo recording received. Live transcription is unavailable in this preview.', 'info');
          else { onTranscript(result.text); toast('Transcription added to your message.'); }
        } catch (error) { if (mounted.current && !cancelled.current) onError(errorMessage(error)); }
        finally { if (mounted.current) setTranscribing(false); }
      };
      current.start(250); setListening(true);
      timeout.current = setTimeout(() => { if (current.state === 'recording') current.stop(); }, 120000);
    } catch (error) {
      acquired?.getTracks().forEach(track=>track.stop());
      recorder.current?.stream.getTracks().forEach(track => track.stop());
      onError(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access in your browser settings and try again.' : 'Could not access a microphone. Check that one is connected and available.');
    } finally { setRequesting(false); }
  }
  return { listening, transcribing, requesting, seconds, toggle, cancel };
}
