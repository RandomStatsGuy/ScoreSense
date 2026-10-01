/** Approved A: detached bubble, hold to reveal hide, full dismissal, settings restore. */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCommunication } from "./CommunicationContext";
import ChatIcon from "./ChatIcon";
import { CHAT_HOLD_MS, FANTASY_CHAT_COPY as COPY, unreadChatLabel } from "./fantasyChatPresentation";

export default function ChatLauncher({leagueId,hidden=false}) {
  const communication=useCommunication();
  const [hideVisible,setHideVisible]=useState(false);
  const [bottom,setBottom]=useState(null);
  const timer=useRef(null), held=useRef(false), start=useRef(null), root=useRef(null);
  const eligible=Boolean(leagueId&&!hidden&&communication?.leagueId===leagueId&&!communication.dismissed);
  const visible=eligible&&!communication?.scene;
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{if(!visible){clearTimeout(timer.current);setHideVisible(false);}},[visible]);
  useEffect(()=>{
    if(!visible)return undefined;
    let frame;
    const observed=new Set();
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    const sizes=new ResizeObserver(schedule);
    const measure=()=>{
      if(innerWidth>768){setBottom(null);return;}
      const launcher=root.current?.getBoundingClientRect();
      const bars=Array.from(document.querySelectorAll('.app-bottom-nav, .hub-rules-sticky-save, .hub-vibes-actions, .hub-office-pending-tray'));
      let top=innerHeight;
      for(const bar of bars){
        if(!observed.has(bar)){sizes.observe(bar);observed.add(bar);}
        const rect=bar.getBoundingClientRect(),position=getComputedStyle(bar).position;
        if(['sticky','fixed'].includes(position)&&rect.height&&rect.top>=innerHeight/2&&rect.top<innerHeight&&rect.right>(launcher?.left||0))top=Math.min(top,rect.top);
      }
      for(const bar of observed)if(!bar.isConnected){sizes.unobserve(bar);observed.delete(bar);}
      setBottom(top<innerHeight?Math.ceil(innerHeight-top+16):null);
    };
    const changes=new MutationObserver(schedule);
    const main=document.getElementById('main-content');
    if(main)changes.observe(main,{childList:true,subtree:true});
    measure();window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,{passive:true});
    return()=>{cancelAnimationFrame(frame);sizes.disconnect();changes.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule);};
  },[visible]);
  useEffect(()=>{
    if(!hideVisible)return undefined;
    const down=event=>{if(!root.current?.contains(event.target))setHideVisible(false);};
    const key=event=>{if(event.key==='Escape'){held.current=false;setHideVisible(false);requestAnimationFrame(()=>root.current?.querySelector('.fantasy-chat-bubble-a')?.focus());}};
    document.addEventListener('pointerdown',down);document.addEventListener('keydown',key);
    return ()=>{document.removeEventListener('pointerdown',down);document.removeEventListener('keydown',key);};
  },[hideVisible]);
  if(!eligible||typeof document==='undefined')return null;
  const count=communication.data.unread;
  const arm=event=>{
    if(event.button!==0)return;
    clearTimeout(timer.current);
    held.current=false;start.current={x:event.clientX,y:event.clientY};
    timer.current=setTimeout(()=>{held.current=true;setHideVisible(true);},CHAT_HOLD_MS);
  };
  const cancel=()=>clearTimeout(timer.current);
  return createPortal(<div className="fantasy-chat-launcher-a" ref={root} hidden={!visible} style={bottom?{bottom}:undefined}>
    <button type="button" className="fantasy-chat-bubble-a" aria-label={`${COPY.openChat}${count?` · ${count} unread messages`:''}`} aria-description={COPY.holdToHide} aria-expanded={communication.scene==='chat'} aria-controls="communication-dialog"
      onPointerDown={arm} onPointerMove={event=>{if(start.current&&Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>8)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={event=>{event.preventDefault();cancel();held.current=true;setHideVisible(true);}}
      onKeyDown={event=>{if(['Delete','Backspace'].includes(event.key)){event.preventDefault();setHideVisible(true);requestAnimationFrame(()=>root.current?.querySelector('.fantasy-chat-hide-a')?.focus());}}}
      onClick={()=>{if(held.current){held.current=false;return;}communication.openChat();}}><ChatIcon/>{count>0&&!hideVisible&&<span className="fantasy-chat-unread-a">{unreadChatLabel(count)}</span>}</button>
    {hideVisible&&<><span className="fantasy-chat-hide-label">{COPY.hideBubble}</span><button type="button" className="fantasy-chat-hide-a" aria-label={COPY.hideBubble} onClick={()=>{communication.setBubble(true);setHideVisible(false);}}><ChatIcon name="close"/></button></>}
  </div>,document.body);
}
