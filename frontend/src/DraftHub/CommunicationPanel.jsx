import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { formatRelativeTime } from "../format";
import useModalFocus from "../ui/useModalFocus";
import { useCommunication } from "./CommunicationContext";
import LeagueChat from "./LeagueChat";
import ChatIcon from "./ChatIcon";
import { CHAT_NOTIFICATION_OPTIONS, FANTASY_CHAT_COPY as COPY } from "./fantasyChatPresentation";

export function NotificationBell() {
  const communication=useCommunication();
  if(!communication?.enabled||!communication.leagueId)return null;
  const count=communication.data.notification_unread;
  return <button type="button" className="chat-icon-btn notification-bell" aria-label={`${COPY.notifications}${count?` · ${count} unread`:''}`} onClick={()=>communication.setScene('notifications')}><ChatIcon name="bell"/>{count>0&&<span className="notification-dot" aria-hidden="true"/>}</button>;
}

export function NotificationSettingsAction({className,onBeforeOpen,role}) {
  const communication=useCommunication();
  if(!communication?.enabled)return null;
  return <button type="button" role={role} className={className} onClick={()=>{onBeforeOpen?.();communication.setScene('settings');}}>{COPY.settings}</button>;
}

export default function CommunicationPanel() {
  const communication=useCommunication();
  const dialogRef=useRef(null), closeRef=useRef(null);
  const scene=communication?.scene;
  useModalFocus(Boolean(scene),dialogRef,()=>communication?.setScene(null),closeRef);
  useEffect(()=>{if(scene)closeRef.current?.focus();},[scene]);
  if(!communication?.enabled||typeof document==='undefined')return null;
  const {data,context,leagueId,setScene,thread,dismissed,setBubble,error,refresh,savePreferences,saving,readAlerts,openNotification,toast,setToast}=communication;
  const partner=data.members.find(member=>thread===`direct:${member.id}`);
  const title=scene==='settings'?COPY.notificationsTitle:scene==='notifications'?COPY.notifications:partner?.name||COPY.leagueChat;
  const notifications=data.notifications.filter(item=>data.preferences[item.kind]);
  return createPortal(<>
    {scene&&<div className="communication-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setScene(null);}}>
      <section id="communication-dialog" className={`communication-window${scene==='chat'?' communication-window--chat':''}`} role="dialog" aria-modal="true" aria-labelledby="communication-title" ref={dialogRef} tabIndex={-1}>
        <header className="communication-head"><div className="communication-identity"><span className="communication-mark" aria-hidden="true"><ChatIcon name={scene==='chat'?'chat':'bell'}/></span><div><h2 id="communication-title">{title}</h2><p title={context?.league_name}>{scene==='settings'?COPY.notificationsSubtitle:context?.league_name}</p></div></div><div className="communication-head-actions">{scene!=='settings'&&<button type="button" className="chat-icon-btn" aria-label={COPY.settings} onClick={()=>setScene('settings')}><ChatIcon name="settings"/></button>}<button ref={closeRef} type="button" className="chat-icon-btn" aria-label={scene==='chat'?COPY.minimize:'Close notifications'} onClick={()=>setScene(null)}><ChatIcon name="minimize"/></button></div></header>
        {scene==='chat'&&leagueId&&<LeagueChat key={leagueId} leagueId={leagueId} hubContext={context} floating/>}
        {scene!=='chat'&&<div className="communication-scroll">
          {error&&<div className="chat-error" role="alert"><span>{error}</span><button type="button" className="btn-link" onClick={()=>refresh()}>{COPY.retry}</button></div>}
          {scene==='settings'?<>
            <p className="notification-intro">{COPY.onSite}</p><p className="notification-section-label">{COPY.alertKinds}</p>
            {CHAT_NOTIFICATION_OPTIONS.map(option=><label className="notification-setting" key={option.id}><span><strong>{option.label}</strong><small>{option.hint}</small></span><input type="checkbox" role="switch" aria-label={option.label} checked={Boolean(data.preferences[option.id])} disabled={saving||!Object.keys(data.preferences).length} onChange={event=>savePreferences({[option.id]:event.target.checked})}/></label>)}
            <p className="notification-section-label">{COPY.chatBubble}</p><label className="notification-setting"><span><strong>{COPY.showBubble}</strong><small>{COPY.restoreHint}</small></span><input type="checkbox" role="switch" aria-label={COPY.showBubble} checked={!dismissed} onChange={event=>setBubble(!event.target.checked)}/></label>
            <p className="notification-footnote">{COPY.badgeHint}</p>
          </>:<>
            <div className="notification-toolbar"><span>{data.notification_unread?`${data.notification_unread} unread`:COPY.allRead}</span>{data.notification_unread>0&&<button type="button" className="btn-link" onClick={()=>readAlerts([],data.notifications[0]?.created_at)}>{COPY.markRead}</button>}</div>
            {notifications.length?notifications.map(item=><button type="button" key={item.id} className={`site-notification${item.read_at?' is-read':''}`} onClick={()=>openNotification(item)}><span className="site-notification-mark" aria-hidden="true">{item.kind==='trade'?'⇄':item.kind==='mention'?'@':<ChatIcon/>}</span><span className="site-notification-copy"><strong>{item.title}</strong><span>{item.body}</span><small>{formatRelativeTime(item.created_at)}</small><span className="site-notification-action">{item.kind==='trade'?COPY.reviewTrade:COPY.openMessage} →</span></span>{!item.read_at&&<span className="site-notification-unread" aria-label="Unread"/>}</button>):!error&&<p className="notification-empty">{COPY.noAlerts}</p>}
          </>}
        </div>}
      </section>
    </div>}
    {toast&&!scene&&<div className="site-alert-toast" role="status"><span className="communication-mark"><ChatIcon name="bell"/></span><div><strong>{toast.title}</strong><p>{toast.body}</p></div><button type="button" className="btn-link" onClick={()=>openNotification(toast)}>{toast.kind==='trade'?'Review':'Open'}</button><button type="button" className="chat-icon-btn" aria-label={COPY.dismissAlert} onClick={()=>setToast(null)}><ChatIcon name="close"/></button></div>}
  </>,document.body);
}
