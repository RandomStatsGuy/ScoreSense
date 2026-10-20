/** Approved A: detached bubble, hold to reveal hide, full dismissal, settings restore. */
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCommunication } from "./CommunicationContext";
import ChatIcon from "./ChatIcon";
import { CHAT_HOLD_MS, FANTASY_CHAT_COPY as COPY, unreadChatLabel } from "./fantasyChatPresentation";

export default function ChatLauncher({leagueId,hidden=false}) {
  const communication=useCommunication();
  const [hideVisible,setHideVisible]=useState(false);
  const timer=useRef(null), held=useRef(false), start=useRef(null), root=useRef(null);
  const eligible=Boolean(leagueId&&!hidden&&communication?.leagueId===leagueId&&!communication.dismissed);
  const visible=eligible&&!communication?.scene;
  useEffect(()=>()=>clearTimeout(timer.current),[]);
  useEffect(()=>{if(!visible){clearTimeout(timer.current);setHideVisible(false);}},[visible]);
  useLayoutEffect(()=>{
    if(!visible)return undefined;
    document.documentElement.classList.add('has-fantasy-chat-launcher');
    // Keep keyboard focus clear by scrolling the page, never by moving chat.
    const revealFocus=event=>{
      const element=event.target, bubble=root.current?.getBoundingClientRect();
      if(!bubble || !(element instanceof HTMLElement) || root.current.contains(element))return;
      const box=element.getBoundingClientRect();
      if(Math.min(box.right,bubble.right)>Math.max(box.left,bubble.left) && Math.min(box.bottom,bubble.bottom)>Math.max(box.top,bubble.top))
        element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    };
    document.addEventListener('focusin',revealFocus);
    return()=>{document.documentElement.classList.remove('has-fantasy-chat-launcher');document.removeEventListener('focusin',revealFocus);};
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
  return createPortal(<div className="fantasy-chat-launcher-a" data-layout-stable="chat-launcher" ref={root} hidden={!visible}>
    <button type="button" className="fantasy-chat-bubble-a" aria-label={`${COPY.openChat}${count?` · ${count} unread messages`:''}`} aria-description={COPY.holdToHide} aria-expanded={communication.scene==='chat'} aria-controls="communication-dialog"
      onPointerDown={arm} onPointerMove={event=>{if(start.current&&Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>8)cancel();}} onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={event=>{event.preventDefault();cancel();held.current=true;setHideVisible(true);}}
      onKeyDown={event=>{if(['Delete','Backspace'].includes(event.key)){event.preventDefault();setHideVisible(true);requestAnimationFrame(()=>root.current?.querySelector('.fantasy-chat-hide-a')?.focus());}}}
      onClick={()=>{if(held.current){held.current=false;return;}communication.openChat();}}><ChatIcon/>{count>0&&!hideVisible&&<span className="fantasy-chat-unread-a" aria-hidden="true">{unreadChatLabel(count)}</span>}</button>
    {hideVisible&&<><span className="fantasy-chat-hide-label">{COPY.hideBubble}</span><button type="button" className="fantasy-chat-hide-a" aria-label={COPY.hideBubble} onClick={()=>{communication.setBubble(true);setHideVisible(false);}}><ChatIcon name="close"/></button></>}
  </div>,document.body);
}
