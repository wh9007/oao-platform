"use client";
import { useCallback, useRef } from "react";
export function useAudioPlayback() {
 const queue=useRef<string[]>([]), playing=useRef(false);
 const playNext=useCallback(()=>{const url=queue.current.shift(); if(!url){playing.current=false;return;} playing.current=true; const audio=new Audio(url); audio.onended=playNext; audio.onerror=playNext; audio.play().catch(playNext);},[]);
 const enqueue=useCallback((url:string)=>{queue.current.push(url);if(!playing.current)playNext();},[playNext]);
 const clear=useCallback(()=>{queue.current=[];playing.current=false;},[]);
 return {enqueue,clear};
}
