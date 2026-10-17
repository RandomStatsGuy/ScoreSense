import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { connectionErrorMessage } from "../format";
import { confirmDialog } from "../ui/confirm";
import useAsyncActionScope from "../ui/useAsyncActionScope";
import { chatRequest, jsonRequest, useCommunication } from "./CommunicationContext";
import ChatIcon from "./ChatIcon";
import { CHAT_REACTIONS, FANTASY_CHAT_COPY as COPY, chatInitials, chatPollMs, matchingChatMembers, messageMentionIds } from "./fantasyChatPresentation";

function MessageBody({message}) {
  const names=(message.mentions||[]).map(person=>person.name).sort((a,b)=>b.length-a.length);
  if(!names.length) return message.body;
  const escaped=names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"));
  const pattern=new RegExp(`(@(?:${escaped.join('|')})(?!\\w))`,'gi');
  return String(message.body).split(pattern).map((part,i)=>part.startsWith('@')&&names.some(name=>part.toLowerCase()==='@'+name.toLowerCase())
    ? <span className="chat-mention" key={i}>{part}</span> : part);
}

export default function ChatThread({ leagueId, hubContext, compact=false, lockedKind=null, floating=false }) {
  const communication=useCommunication();
  const shared=communication?.leagueId===leagueId ? communication : null;
  const [kind,setKind]=useState(lockedKind||'league');
  const [directList,setDirectList]=useState(false);
  const [messages,setMessages]=useState([]);
  const [localMembers,setLocalMembers]=useState([]);
  const [body,setBody]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [readError,setReadError]=useState('');
  const [sending,setSending]=useState(false);
  const [reactionBusy,setReactionBusy]=useState(null);
  const [clearing,setClearing]=useState(false);
  const [emojiFor,setEmojiFor]=useState(null);
  const [mention,setMention]=useState(null);
  const [selectedMention,setSelectedMention]=useState(0);
  const listRef=useRef(null), inputRef=useRef(null), initialScroll=useRef(true), follow=useRef(true), readId=useRef(null);
  const id=useId();
  const requestedThread=lockedKind || (floating ? shared?.thread : kind) || 'league';
  const thread=requestedThread==='office'&&!hubContext?.is_commissioner?'league':requestedThread;
  const base=`/api/hub/league/${encodeURIComponent(leagueId)}`;
  const key=`${shared?.scopeKey||`${leagueId}:${hubContext?.team_id||''}`}:${thread}`;
  const captureReadScope=useAsyncActionScope(key);
  const [previousKey,setPreviousKey]=useState(key);
  if(previousKey!==key){setPreviousKey(key);setMessages([]);setBody('');setLoading(true);setError('');setReadError('');}
  useEffect(()=>{
    if(requestedThread==='office'&&!hubContext?.is_commissioner){setKind('league');if(floating)shared?.setThread('league');}
  },[requestedThread,hubContext?.is_commissioner,floating,shared?.setThread]);

  const requestVersion=useRef(0);
  const people=shared?.data.members || localMembers;
  const myTeamId=hubContext?.team_id;
  const isDirect=thread.startsWith('direct:');
  const partner=people.find(person=>person.id===thread.slice(7));
  const eligible=thread==='office'?people.filter(person=>person.is_staff||person.id===myTeamId)
    :isDirect?people.filter(person=>person.id===partner?.id||person.id===myTeamId):people;
  const suggestions=mention ? matchingChatMembers(eligible,mention.query,myTeamId) : [];
  const canWrite=Boolean(leagueId&&myTeamId&&!hubContext?.readonly&&!hubContext?.demo&&communication?.enabled!==false&&(!isDirect||partner?.can_message));
  const writeScope=JSON.stringify([key,communication?.scopeKey,canWrite,Boolean(hubContext?.is_primary_commissioner),Boolean(hubContext?.is_commissioner)]);
  const captureWriteScope=useAsyncActionScope(writeScope);
  const bodyRef=useRef(body); bodyRef.current=body;
  useEffect(()=>{setSending(false);setReactionBusy(null);setClearing(false);setError('');},[writeScope]);

  const setThread=next=>{setKind(next);if(floating)shared?.setThread(next);setDirectList(false);};

  const markRead=useCallback(async rows=>{
    const latest=rows.at(-1)?.id;
    if(!latest||document.hidden||readId.current===latest||directList) return;
    const isCurrent=captureReadScope();
    readId.current=latest;
    try { await chatRequest(`${base}/chat/read`,jsonRequest({thread,last_id:latest})); if(isCurrent())shared?.refresh(); }
    catch { if(isCurrent())readId.current=null; }
  },[base,thread,key,directList,shared?.refresh]);

  const load=useCallback(async signal=>{
    if(!leagueId) return;
    const version=++requestVersion.current;
    const isCurrent=captureReadScope();
    try {
      const data=await chatRequest(`${base}/chat/thread/${encodeURIComponent(thread)}`,{signal});
      if(signal?.aborted||!isCurrent()||version!==requestVersion.current) return;
      const list=listRef.current;
      follow.current=initialScroll.current||!list||list.scrollHeight-list.scrollTop-list.clientHeight<72;
      setMessages(data.messages||[]); setReadError('');
      if(follow.current) markRead(data.messages||[]);
    } catch(e) { if(!signal?.aborted&&isCurrent()&&version===requestVersion.current) setReadError(connectionErrorMessage(e)); }
    finally { if(!signal?.aborted&&isCurrent()&&version===requestVersion.current) setLoading(false); }
  },[base,thread,key,leagueId,markRead]);

  useEffect(()=>{
    if(shared||!leagueId) return undefined;
    const controller=new AbortController();
    setLocalMembers([]);
    chatRequest(`${base}/chat/summary`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setLocalMembers(data.members||[]);}).catch(()=>{});
    return ()=>controller.abort();
  },[base,leagueId,Boolean(shared)]);

  useEffect(()=>{
    setLoading(true); setMessages([]); setBody(''); setError(''); setReadError(''); setMention(null); setEmojiFor(null); setSending(false); setReactionBusy(null); setClearing(false); readId.current=null; initialScroll.current=true;
    const controller=new AbortController();
    let timer, generation=0;
    const tick=async()=>{
      const run=++generation;
      if(!document.hidden) await load(controller.signal);
      if(!controller.signal.aborted&&run===generation)timer=setTimeout(tick,chatPollMs({compact,hidden:document.hidden}));
    };
    const visibility=()=>{clearTimeout(timer);tick();};
    tick(); document.addEventListener('visibilitychange',visibility);
    return ()=>{controller.abort();generation++;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
  },[load,compact]);

  useEffect(()=>{if(listRef.current&&follow.current){listRef.current.scrollTop=listRef.current.scrollHeight;initialScroll.current=false;}},[messages]);

  const chooseMention=person=>{
    const input=inputRef.current;
    const insertion='@'+person.name+' ';
    const after=body.slice(input.selectionStart);
    setBody(body.slice(0,mention.start)+insertion+after);
    const cursor=mention.start+insertion.length;
    setMention(null);
    requestAnimationFrame(()=>{input.focus();input.setSelectionRange(cursor,cursor);});
  };
  const updateMention=(text,cursor)=>{
    const match=text.slice(0,cursor).match(/(?:^|\s)@([\w]*)$/);
    setMention(match?{start:cursor-match[1].length-1,query:match[1]}:null); setSelectedMention(0);
  };
  const send=async event=>{
    event.preventDefault(); const text=body.trim(); if(!text||sending||!canWrite) return;
    const submitted=body, isCurrent=captureWriteScope();setSending(true);setError('');
    try {
      const response=await chatRequest(`${base}/chat/thread/${encodeURIComponent(thread)}`,jsonRequest({body:text,mentions:messageMentionIds(text,eligible)}));
      if(!isCurrent())return;
      requestVersion.current++;
      follow.current=true;
      setMessages(prev=>prev.some(m=>m.id===response.message.id)?prev:[...prev,response.message]);
      const unchanged=bodyRef.current===submitted;
      setBody(current=>current===submitted?'':current);
      if(unchanged){setMention(null);setEmojiFor(null);inputRef.current?.focus();}
      shared?.refresh();
    } catch(e){if(isCurrent())setError(connectionErrorMessage(e));}
    finally{if(isCurrent())setSending(false);}
  };
  const react=async(message,emoji)=>{
    if(reactionBusy||!canWrite) return;
    const isCurrent=captureWriteScope();setReactionBusy(message.id);setError('');
    try {
      const mine=message.reactions?.find(r=>r.emoji===emoji)?.mine;
      const response=await chatRequest(`${base}/chat/messages/${encodeURIComponent(message.id)}/reactions`,jsonRequest({emoji,pressed:!mine},'PUT'));
      if(isCurrent()){requestVersion.current++;follow.current=false;setMessages(prev=>prev.map(m=>m.id===message.id?response.message:m));setEmojiFor(null);}
    }catch(e){if(isCurrent())setError(connectionErrorMessage(e));}
    finally{if(isCurrent())setReactionBusy(null);}
  };
  const clear=async()=>{
    if(!hubContext?.is_primary_commissioner||!canWrite||isDirect||clearing)return;
    const isCurrent=captureWriteScope();
    if(!await confirmDialog({title:`Clear ${thread==='office'?COPY.staff:COPY.league} chat`,message:'Delete all messages in this channel? This cannot be undone.',confirmLabel:COPY.clear,danger:true}))return;
    if(!isCurrent())return;
    setClearing(true);setError('');
    try{await chatRequest(`${base}/chat/${thread}/messages`,{method:'DELETE'});if(isCurrent()){requestVersion.current++;setMessages([]);shared?.refresh();}}
    catch(e){if(isCurrent())setError(connectionErrorMessage(e));}
    finally{if(isCurrent())setClearing(false);}
  };
  const onInputKey=event=>{
    if(mention&&suggestions.length){
      if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();setSelectedMention(i=>(i+(event.key==='ArrowDown'?1:-1)+suggestions.length)%suggestions.length);return;}
      if(event.key==='Enter'){event.preventDefault();chooseMention(suggestions[selectedMention]);return;}
    }
    if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();inputRef.current.form.requestSubmit();}
  };
  const directUnread=(shared?.data.threads||[]).filter(t=>t.key.startsWith('direct:')).reduce((sum,t)=>sum+t.unread,0);
  const tabs=[{key:'league',label:COPY.league},{key:'direct',label:COPY.direct},...(hubContext?.is_commissioner?[{key:'office',label:COPY.staff}]:[])];

  return <div className={`hub-league-chat chat-thread${compact?' is-compact':''}${floating?' is-floating':''}`}>
    {!compact&&!lockedKind&&<div className="chat-channel-bar"><div className="chat-channels" role="tablist" aria-label="Chat channels">{tabs.map((tab,i)=>{
      const selected=tab.key==='direct'?(isDirect||directList):thread===tab.key&&!directList;
      return <button type="button" role="tab" id={`${id}-tab-${tab.key}`} key={tab.key} aria-controls={`${id}-messages`} aria-selected={selected} tabIndex={selected?0:-1}
        onKeyDown={event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const next=tabs[(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length];document.getElementById(`${id}-tab-${next.key}`)?.click();document.getElementById(`${id}-tab-${next.key}`)?.focus();}}}
        onClick={()=>tab.key==='direct'?setDirectList(true):setThread(tab.key)}>{tab.label}{tab.key==='direct'&&directUnread>0&&<span className="chat-small-count">{directUnread}</span>}</button>;
    })}</div>{hubContext?.is_primary_commissioner&&canWrite&&!isDirect&&!directList&&<details className="chat-admin-menu"><summary aria-label="Chat actions">···</summary><button type="button" className="btn-danger btn-sm" onClick={clear} disabled={loading||clearing||!messages.length}>{COPY.clear}</button></details>}</div>}
    {compact?<div className="hub-league-chat-compact-head"><strong>Draft chat</strong></div>:<div className="chat-thread-context"><span>{directList?COPY.directTitle:isDirect?partner?.name:thread==='office'?COPY.staffOnly:COPY.context}</span></div>}
    {(error||readError)&&<div className="chat-error" role="alert"><span>{error||readError}</span><button type="button" className="btn-link" onClick={()=>{setError('');load();}}>{COPY.retry}</button></div>}
    {directList?<div className="chat-direct-list" id={`${id}-messages`} role="tabpanel" aria-labelledby={`${id}-tab-direct`}>
      <p className="chart-note">{COPY.members}</p>{people.filter(person=>person.id!==myTeamId&&person.can_message).map(person=>{
        const t=shared?.data.threads.find(item=>item.key===`direct:${person.id}`);
        return <button type="button" className="chat-direct-person" key={person.id} onClick={()=>setThread(`direct:${person.id}`)}><span className="chat-avatar">{chatInitials(person.name)}</span><span><strong>{person.name}</strong><small>{t?.latest?.body||person.team_name}</small></span>{t?.unread>0&&<span className="chat-small-count">{t.unread}</span>}</button>;
      })}{!people.some(person=>person.id!==myTeamId&&person.can_message)&&<p className="chart-note">{COPY.noManagers}</p>}
    </div>:<>
      <div className="hub-league-chat-list chat-message-list" ref={listRef} id={`${id}-messages`} role="tabpanel" aria-labelledby={!compact&&!lockedKind?`${id}-tab-${isDirect?'direct':thread}`:undefined}
        onScroll={()=>{const list=listRef.current;if(list.scrollHeight-list.scrollTop-list.clientHeight<24)markRead(messages);}}>
        {loading&&<div className="chat-loading" aria-label={COPY.loading}><span/><span/><span/></div>}
        {!loading&&!error&&!readError&&!messages.length&&<p className="chart-note">{COPY.noMessages}</p>}
        {messages.map(message=><article key={message.id} className={`chat-message${message.team_id===myTeamId?' is-mine':''}`}>
          <span className="chat-avatar" aria-hidden="true">{chatInitials(message.owner_name||message.team_name)}</span><div className="chat-message-content"><div className="chat-message-meta"><strong>{message.owner_name||message.team_name||'Manager'}</strong><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}</time></div>
          <p className="chat-message-body"><MessageBody message={message}/></p>
          <div className="chat-reactions">{(message.reactions||[]).map(reaction=><button type="button" className="chat-reaction" key={reaction.emoji} aria-pressed={reaction.mine} aria-label={`${reaction.emoji} · ${reaction.count}${reaction.mine?' · selected':''}`} disabled={Boolean(reactionBusy)||!canWrite} onClick={()=>react(message,reaction.emoji)}><span>{reaction.emoji}</span><span>{reaction.count}</span></button>)}<button type="button" className="chat-reaction chat-reaction-add" aria-label={COPY.react} disabled={!canWrite} onClick={()=>setEmojiFor(emojiFor===message.id?null:message.id)}><ChatIcon name="smile"/><span>+</span></button></div>
          {emojiFor===message.id&&<div className="chat-emoji-row" role="group" aria-label={COPY.react}>{CHAT_REACTIONS.map(emoji=><button type="button" key={emoji} disabled={Boolean(reactionBusy)||!canWrite} onClick={()=>react(message,emoji)} aria-label={`React ${emoji}`}>{emoji}</button>)}</div>}
        </div></article>)}
      </div>
      <form className="hub-league-chat-compose chat-composer" onSubmit={send}>
        {!canWrite&&<p className="chart-note">{isDirect&&!partner?.can_message?COPY.directUnavailable:COPY.readOnly}</p>}
        {mention&&suggestions.length>0&&<div className="chat-mention-picker" id={`${id}-mention`} role="listbox" aria-label={COPY.mention}>{suggestions.map((person,i)=><button type="button" role="option" id={`${id}-person-${i}`} aria-selected={i===selectedMention} key={person.id} onMouseDown={event=>event.preventDefault()} onClick={()=>chooseMention(person)}><span className="chat-avatar">{chatInitials(person.name)}</span><span><strong>{person.name}</strong><small>{person.team_name}</small></span></button>)}</div>}
        <div className="chat-compose-field"><textarea ref={inputRef} disabled={!canWrite} value={body} onChange={event=>{setBody(event.target.value);updateMention(event.target.value,event.target.selectionStart);}} onKeyDown={onInputKey}
          placeholder={isDirect?COPY.messageDirect(partner?.name||'manager'):thread==='office'?COPY.messageStaff:COPY.messageLeague} rows="2" maxLength={2000} aria-label="Chat message" role="combobox" aria-autocomplete="list" aria-expanded={Boolean(mention&&suggestions.length)} aria-controls={mention&&suggestions.length?`${id}-mention`:undefined} aria-activedescendant={mention&&suggestions.length?`${id}-person-${selectedMention}`:undefined}/>
          <div className="chat-compose-tools"><div><button className="chat-icon-btn" type="button" aria-label={COPY.mention} disabled={!canWrite} onClick={()=>{const input=inputRef.current;const at=input.selectionStart;const next=body.slice(0,at)+'@'+body.slice(at);setBody(next);updateMention(next,at+1);requestAnimationFrame(()=>{input.focus();input.setSelectionRange(at+1,at+1);});}}>@</button><button className="chat-icon-btn" type="button" aria-label={COPY.addEmoji} disabled={!canWrite} onClick={()=>setEmojiFor(emojiFor==='compose'?null:'compose')}><ChatIcon name="smile"/></button></div><button type="submit" className={floating?'chat-send':'btn-ghost btn-sm'} disabled={sending||loading||!body.trim()||!canWrite}>{sending?COPY.sending:COPY.send}{floating&&<ChatIcon name="send"/>}</button></div>
        </div>{emojiFor==='compose'&&<div className="chat-compose-emoji chat-emoji-row" role="group" aria-label={COPY.addEmoji}>{CHAT_REACTIONS.map(emoji=><button type="button" key={emoji} onClick={()=>{setBody(text=>text+emoji);setEmojiFor(null);inputRef.current?.focus();}} aria-label={`Insert ${emoji}`}>{emoji}</button>)}</div>}
        {floating&&<p className="chat-compose-hint">{COPY.composerHint}</p>}
      </form>
    </>}
  </div>;
}
