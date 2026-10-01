/* Local, interactive design preview. All people, messages, and events are samples. */
(() => {
 const $ = id => document.getElementById(id);
 const option = document.body.dataset.option;
 const people = [
  {name:'Jordan Davis', initials:'JD', team:'Sunday Drivers'},
  {name:'Alex Rivera', initials:'AR', team:'Fourth & Long'},
  {name:'Connor Lewis', initials:'CL', team:'End Zone Club'},
  {name:'Maya Chen', initials:'MC', team:'You'},
 ];
 const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const smile = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14s1 3 4 3 4-3 4-3M8 9h.01M16 9h.01"/></svg>';
 const messages = {
  league:[
   {id:1,name:'Alex Rivera',initials:'AR',time:'9:42 AM',text:'Anyone looking for a running back? I’m open to moving one.',reactions:[['👀',3],['👍',2]]},
   {id:2,name:'Jordan Davis',initials:'JD',time:'9:44 AM',text:'@Connor Lewis you still need an RB? We should talk before Sunday.',reactions:[['😂',4]]},
   {id:3,name:'Maya Chen',initials:'MC',time:'9:46 AM',text:'This league never takes a day off 😂',reactions:[]},
   {id:4,name:'Connor Lewis',initials:'CL',time:'10:02 AM',text:'@Jordan Davis send me an offer. My bench is officially open for business.',reactions:[['🤝',2]],unread:true},
  ],
  jordan:[{id:5,name:'Jordan Davis',initials:'JD',time:'9:58 AM',text:'Would you move Drake London? I can send an RB your way.',reactions:[]}],
  alex:[{id:6,name:'Alex Rivera',initials:'AR',time:'Yesterday',text:'Good game this week. That last drive was brutal 😂',reactions:[['🤝',1]]}],
  connor:[],
  staff:[{id:7,name:'Alex Rivera',initials:'AR',time:'Yesterday',text:'Waiver order is updated. I’ll post the reminder in league chat tonight.',reactions:[['👍',1]]}],
 };
 const unread = {league:2,jordan:1,alex:1,connor:0,staff:0};
 const preferences = {trade:true,dm:true,mention:true,draft:true,lineup:false,league:false};
 const settingLabels = [
  ['trade','Trade offers & responses','When a trade needs your attention.'],
  ['dm','Direct messages','Messages sent just to you.'],
  ['mention','@mentions','When a manager mentions you.'],
  ['draft','Draft updates','Your turn and draft reminders.'],
  ['lineup','Lineup & waiver updates','Locks, claims, and roster changes.'],
  ['league','League messages','Off by default. The bubble still counts unread.'],
 ];
 let notifications = [
  {type:'trade',title:'Jordan Davis sent a trade offer',text:'Drake London for TreVeyon Henderson + a pick.',time:'2 minutes ago',action:'Review trade',read:false},
  {type:'mention',title:'Connor Lewis mentioned you',text:'“@Maya Chen are you starting London this week?”',time:'8 minutes ago',action:'Open league chat',read:false},
  {type:'dm',title:'Direct message from Jordan Davis',text:'“Would you move Drake London?”',time:'12 minutes ago',action:'Open message',read:false},
 ];
 let scene='closed', channel='league', hiddenBubble=false, previousScene='chat', nextId=8;
 let holdTimer, holdActive=false, pointerStart, mentionMatches=[], mentionIndex=0, mentionStart=0, reactionTarget=null, toastAction=null, focusBefore;

 function updateCounts() {
  const count=Object.values(unread).reduce((a,b)=>a+b,0);
  $('unread-count').textContent=count>99?'99+':count;
  $('unread-count').hidden=!count;
  $('chat-bubble').setAttribute('aria-label',`Open chat${count?` · ${count} unread messages`:''}`);
  const unreadAlerts=notifications.filter(n=>!n.read).length;
  document.querySelectorAll('[data-action="alerts"]').forEach(button=>{
   button.setAttribute('aria-label',`Notifications · ${unreadAlerts} unread`);
   const dot=button.querySelector('.alert-dot'); if(dot) dot.hidden=!unreadAlerts;
  });
  $('alerts-total').textContent=unreadAlerts?`${unreadAlerts} unread`:'All caught up';
  $('bubble-setting').checked=!hiddenBubble;
 }
 function hideHold() { clearTimeout(holdTimer); $('hide-bubble').hidden=true; $('hold-hint').hidden=true; }
 function setScene(next, {focus=true}={}) {
  if(scene==='closed' && next!=='closed') focusBefore=document.activeElement;
  scene=next;
  $('more-menu').hidden=true;
  ['chat','alerts','settings'].forEach(id=>$(id+'-overlay').hidden=next!==id);
  $('launcher').hidden=next!=='closed'||hiddenBubble;
  $('chat-bubble').setAttribute('aria-expanded',next==='chat');
  document.querySelectorAll('[data-scene]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.scene===next));
  document.querySelector('.mock-viewport').inert=next!=='closed';
  document.querySelector('.phone-nav').inert=next!=='closed';
  document.body.style.overflow=next==='closed'?'':'hidden';
  hideHold();
  if(next==='chat') { unread[channel]=0; renderThread(); $('thread-panel').scrollTop=$('thread-panel').scrollHeight; }
  if(next==='alerts') renderNotifications();
  updateCounts();
  if(focus) {
   if(next==='closed') { if(focusBefore?.isConnected && !focusBefore.closest('[hidden]') && !focusBefore.inert) focusBefore.focus(); }
   else document.querySelector(`#${next}-overlay [role="dialog"]`).focus();
  }
 }
 function messageHtml(message) {
  let text=escape(message.text);
  people.forEach(person=>text=text.replaceAll('@'+person.name,`<span class="mention">@${person.name}</span>`));
  const reactions=message.reactions.map(([emoji,count,selected])=>`<button class="reaction" data-react="${message.id}" data-emoji="${emoji}" aria-pressed="${Boolean(selected)}" aria-label="${emoji} reaction · ${count}${selected?' · selected':''}"><span>${emoji}</span><span>${count}</span></button>`).join('');
  return `${message.unread?'<div class="new-divider">New messages</div>':''}<article class="message"><span class="avatar ${message.name==='Maya Chen'?'is-you':''}" aria-hidden="true">${message.initials}</span><div><div class="message-meta"><strong>${message.name}${message.name==='Maya Chen'?' · You':''}</strong><time>${message.time}</time></div><p class="message-text">${text}</p><div class="reactions">${reactions}<button class="reaction add-reaction" data-add-reaction="${message.id}" aria-label="React to ${message.name}’s message">${smile}<span>+</span></button></div></div></article>`;
 }
 function inboxItem(key,name,initials,last) {
  return `<button class="inbox-item" data-thread="${key}" ${channel===key?'aria-current="true"':''}><span class="avatar">${initials}</span><span class="inbox-copy"><strong>${name}</strong><small>${last}</small></span>${unread[key]?`<span class="small-count">${unread[key]}</span>`:''}</button>`;
 }
 function renderInbox() {
  $('rail-inbox').innerHTML=inboxItem('league','League chat','LC','Everyone in the league')+inboxItem('staff','Staff','ST','Commissioners only');
  $('rail-direct').innerHTML=inboxItem('jordan','Jordan Davis','JD','Would you move London?')+inboxItem('alex','Alex Rivera','AR','Good game this week.')+inboxItem('connor','Connor Lewis','CL','Start a conversation');
 }
 function renderThread() {
  renderInbox();
  const direct=['jordan','alex','connor'].includes(channel);
  const currentName={league:'Everyone in the league',staff:'Staff only',jordan:'Jordan Davis',alex:'Alex Rivera',connor:'Connor Lewis'}[channel];
  $('thread-label').textContent=currentName;
  $('chat-title').textContent=direct?currentName:channel==='staff'?'Staff chat':'League chat';
  $('presence').textContent=channel==='league'?'4 online':channel==='staff'?'2 online':'Online';
  $('message-input').placeholder=direct?`Message ${currentName.split(' ')[0]}…`:channel==='staff'?'Message league staff…':'Message your league…';
  $('message-input').setAttribute('aria-label',direct?`Message ${currentName}`:'Message your league');
  document.querySelectorAll('[data-channel]').forEach(tab=>{
   const selected=tab.dataset.channel===(direct?'direct':channel);
   tab.setAttribute('aria-selected',selected); tab.tabIndex=selected?0:-1;
  });
  $('thread-panel').setAttribute('aria-labelledby',`tab-${direct?'direct':channel}`);
  $('thread-panel').innerHTML='<div class="date-divider">Today · Oct 1</div>'+((messages[channel]||[]).map(messageHtml).join('')||'<p class="muted">Start a conversation with this manager.</p>');
  $('composer').hidden=false;
  $('emoji-picker').hidden=true;
  updateCounts();
 }
 function selectThread(key) { channel=key; unread[key]=0; $('chat-body').classList.remove('show-inbox'); renderThread(); $('thread-panel').scrollTop=$('thread-panel').scrollHeight; }
 function showDirectList() {
  if(option==='b') { $('chat-body').classList.add('show-inbox'); return; }
  document.querySelectorAll('[data-channel]').forEach(tab=>{tab.setAttribute('aria-selected',tab.dataset.channel==='direct'); tab.tabIndex=tab.dataset.channel==='direct'?0:-1;});
  $('thread-label').textContent='Your direct messages';
  $('thread-panel').setAttribute('aria-labelledby','tab-direct');
  $('thread-panel').innerHTML='<div class="inbox-list">'+inboxItem('jordan','Jordan Davis','JD','Would you move London?')+inboxItem('alex','Alex Rivera','AR','Good game this week.')+inboxItem('connor','Connor Lewis','CL','Start a conversation')+'</div>';
  $('composer').hidden=true;
 }
 function renderNotifications() {
  $('notification-list').innerHTML=notifications.map((n,i)=>`<button class="notification-item ${n.read?'is-read':''}" data-notification="${i}"><span aria-hidden="true">${n.type==='trade'?'⇄':n.type==='mention'?'@':smile}</span><span class="notification-copy"><strong>${escape(n.title)}</strong><p>${escape(n.text)}</p><small>${n.time}</small><span class="notification-link">${n.action} →</span></span></button>`).join('');
 }
 function notify(type) {
  setScene('closed');
  const config={
   trade:{title:'New trade offer',text:'Jordan Davis sent you a trade.',action:'Review trade',key:'jordan'},
   dm:{title:'Jordan Davis messaged you',text:'“Let’s talk about that London trade.”',action:'Open message',key:'jordan'},
   mention:{title:'Connor Lewis mentioned you',text:'“@Maya Chen who are you starting?”',action:'Open league chat',key:'league'},
   chat:{title:'New league message',text:'Alex Rivera: “Sunday can’t come soon enough.”',action:'Open league chat',key:'league'},
  }[type];
  if(type!=='trade') {
   unread[config.key]+=1;
   messages[config.key].push({id:nextId++,name:type==='dm'?'Jordan Davis':type==='mention'?'Connor Lewis':'Alex Rivera',initials:type==='dm'?'JD':type==='mention'?'CL':'AR',time:'Now',text:type==='mention'?'@Maya Chen who are you starting?':type==='dm'?'Let’s talk about that London trade.':'Sunday can’t come soon enough.',reactions:[],unread:true});
  }
  if(type!=='chat') notifications.unshift({type,title:config.title,text:config.text,time:'Just now',action:config.action,read:false});
  document.querySelectorAll('.review-states details').forEach(d=>d.open=false);
  updateCounts();
  const wantsAlert=preferences[type==='chat'?'league':type];
  $('site-toast').hidden=!wantsAlert;
  if(wantsAlert) {
   $('toast-title').textContent=config.title;
   $('toast-copy').textContent=config.text;
   $('toast-open').textContent=type==='trade'?'Review':'Open';
   toastAction=()=>{ $('site-toast').hidden=true; if(type==='trade'){setScene('alerts');} else {selectThread(config.key);setScene('chat');} };
  }
 }
 function showMentions() {
  const input=$('message-input');
  const before=input.value.slice(0,input.selectionStart);
  const match=before.match(/(?:^|\s)@([\w]*)$/);
  if(!match) { $('mention-picker').hidden=true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant'); return; }
  mentionStart=input.selectionStart-match[1].length-1;
  mentionMatches=people.filter(p=>p.name!=='Maya Chen' && p.name.toLowerCase().includes(match[1].toLowerCase()));
  mentionIndex=0;
  renderMentions();
 }
 function renderMentions() {
  $('mention-picker').hidden=!mentionMatches.length;
  $('message-input').setAttribute('aria-expanded',String(Boolean(mentionMatches.length)));
  $('mention-picker').innerHTML='<p>Mention a league manager</p>'+mentionMatches.map((p,i)=>`<button type="button" class="mention-option" id="mention-${i}" role="option" aria-selected="${i===mentionIndex}" data-mention="${i}"><span class="avatar">${p.initials}</span><span><strong>${p.name}</strong><small>${p.team}</small></span></button>`).join('');
  if(mentionMatches.length) $('message-input').setAttribute('aria-activedescendant',`mention-${mentionIndex}`);
 }
 function chooseMention(index) {
  const input=$('message-input');
  const name=mentionMatches[index]?.name;
  if(!name) return;
  const end=input.selectionStart;
  const inserted='@'+name+' ';
  input.value=input.value.slice(0,mentionStart)+inserted+input.value.slice(end);
  const pos=mentionStart+inserted.length;
  input.focus(); input.setSelectionRange(pos,pos);
  $('mention-picker').hidden=true; input.setAttribute('aria-expanded','false'); input.removeAttribute('aria-activedescendant');
  $('send-message').disabled=!input.value.trim();
 }
 function openEmoji(messageId=null) {
  reactionTarget=messageId;
  $('emoji-picker').innerHTML=['👍','😂','🔥','👀','🤝'].map(emoji=>`<button type="button" data-pick-emoji="${emoji}" aria-label="${messageId?'React with':'Insert'} ${emoji}">${emoji}</button>`).join('');
  $('emoji-picker').hidden=false;
 }
 function react(messageId,emoji) {
  const message=Object.values(messages).flat().find(m=>m.id===Number(messageId));
  if(!message) return;
  let reaction=message.reactions.find(r=>r[0]===emoji);
  if(!reaction) { reaction=[emoji,0,false]; message.reactions.push(reaction); }
  reaction[1]+=reaction[2]?-1:1; reaction[2]=!reaction[2];
  message.reactions=message.reactions.filter(r=>r[1]>0);
  const scroll=$('thread-panel').scrollTop; renderThread(); $('thread-panel').scrollTop=scroll;
 }

 $('settings-rows').innerHTML=settingLabels.map(([key,title,subtitle])=>`<label class="setting-row"><span><strong>${title}</strong><small>${subtitle}</small></span><input type="checkbox" data-preference="${key}" ${preferences[key]?'checked':''} aria-label="${title}"></label>`).join('');
 document.addEventListener('change',event=>{
  if(event.target.dataset.preference) preferences[event.target.dataset.preference]=event.target.checked;
  if(event.target.id==='bubble-setting') { hiddenBubble=!event.target.checked; updateCounts(); }
 });
 document.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button) return;
  const {scene:previewScene,action,thread,channel:tabChannel,demo,react:reactionId,emoji,addReaction,mention,pickEmoji,notification}=button.dataset;
  if(previewScene) { $('site-toast').hidden=true; setScene(previewScene); }
  if(thread) selectThread(thread);
  if(tabChannel) tabChannel==='direct'?showDirectList():selectThread(tabChannel);
  if(demo) notify(demo);
  if(reactionId) react(reactionId,emoji);
  if(addReaction) openEmoji(Number(addReaction));
  if(mention!==undefined) chooseMention(Number(mention));
  if(pickEmoji) {
   if(reactionTarget) react(reactionTarget,pickEmoji);
   else { $('message-input').value+=pickEmoji; $('message-input').focus(); $('send-message').disabled=false; }
   $('emoji-picker').hidden=true;
  }
  if(notification!==undefined) {
   const item=notifications[Number(notification)]; item.read=true;
   if(item.type==='trade') { $('site-toast').hidden=false; $('toast-title').textContent='Trade review preview'; $('toast-copy').textContent='Jordan Davis · London for Henderson + a pick.'; $('toast-open').textContent='Done'; toastAction=()=>$('site-toast').hidden=true; renderNotifications(); updateCounts(); }
   else { selectThread(item.type==='dm'?'jordan':'league'); setScene('chat'); }
  }
  if(action==='close') setScene('closed');
  if(action==='alerts') setScene('alerts');
  if(action==='settings') { previousScene=scene; setScene('settings'); }
  if(action==='settings-back') setScene(previousScene==='settings'?'closed':previousScene);
  if(action==='inbox'||action==='new-dm') showDirectList();
  if(action==='mention') { const input=$('message-input'); const start=input.selectionStart; input.value=input.value.slice(0,start)+'@'+input.value.slice(start); input.focus(); input.setSelectionRange(start+1,start+1); showMentions(); }
  if(action==='emoji') openEmoji();
  if(action==='more') $('more-menu').hidden=!$('more-menu').hidden;
  if(action==='restore') { hiddenBubble=false; setScene('closed'); }
  if(action==='mark-read') { notifications.forEach(n=>n.read=true); renderNotifications(); updateCounts(); }
  if(action==='theme') document.documentElement.dataset.theme=document.documentElement.dataset.theme==='light'?'dark':'light';
 });
 document.querySelectorAll('.overlay').forEach(backdrop=>backdrop.addEventListener('click',event=>{ if(event.target===backdrop) setScene('closed'); }));
 $('message-input').addEventListener('input',()=>{ $('send-message').disabled=!$('message-input').value.trim(); showMentions(); });
 $('message-input').addEventListener('keydown',event=>{
  if(!$('mention-picker').hidden) {
   if(event.key==='ArrowDown'||event.key==='ArrowUp') { event.preventDefault(); mentionIndex=(mentionIndex+(event.key==='ArrowDown'?1:-1)+mentionMatches.length)%mentionMatches.length; renderMentions(); return; }
   if(event.key==='Enter') { event.preventDefault(); chooseMention(mentionIndex); return; }
   if(event.key==='Escape') { event.preventDefault(); event.stopPropagation(); $('mention-picker').hidden=true; return; }
  }
  if(event.key==='Enter'&&!event.shiftKey) { event.preventDefault(); $('composer').requestSubmit(); }
 });
 $('composer').addEventListener('submit',event=>{
  event.preventDefault(); const text=$('message-input').value.trim(); if(!text) return;
  messages[channel].push({id:nextId++,name:'Maya Chen',initials:'MC',time:'Now',text,reactions:[]});
  $('message-input').value=''; $('send-message').disabled=true; $('mention-picker').hidden=true;
  renderThread(); $('thread-panel').scrollTop=$('thread-panel').scrollHeight; $('message-input').focus();
 });
 document.addEventListener('keydown',event=>{
  if(event.key==='Escape') { if(!$('emoji-picker').hidden) { $('emoji-picker').hidden=true; return; } if(!$('more-menu').hidden) { $('more-menu').hidden=true; return; } setScene('closed'); }
  if(event.key==='Tab'&&scene!=='closed') {
   const modal=document.querySelector(`#${scene}-overlay [role="dialog"]`);
   const targets=[...modal.querySelectorAll('button:not(:disabled),textarea,input,a[href]')].filter(el=>el.getClientRects().length&&el.tabIndex>=0);
   const first=targets[0],last=targets.at(-1);
   if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)) { event.preventDefault(); last?.focus(); }
   else if(!event.shiftKey&&(document.activeElement===last||!modal.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
  if(event.target.matches('[role="tab"]')&&['ArrowLeft','ArrowRight'].includes(event.key)) {
   event.preventDefault(); const tabs=[...document.querySelectorAll('[role="tab"]')]; const i=tabs.indexOf(event.target); const next=tabs[(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length]; next.click(); next.focus();
  }
 });
 const bubble=$('chat-bubble');
 bubble.addEventListener('pointerdown',event=>{
  if(event.button!==0) return;
  hideHold(); holdActive=false; pointerStart={x:event.clientX,y:event.clientY};
  holdTimer=setTimeout(()=>{ holdActive=true; $('hide-bubble').hidden=false; $('hold-hint').hidden=false; $('unread-count').hidden=true; },600);
 });
 bubble.addEventListener('pointermove',event=>{ if(pointerStart&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>8) clearTimeout(holdTimer); });
 ['pointerup','pointercancel','pointerleave'].forEach(name=>bubble.addEventListener(name,()=>{ clearTimeout(holdTimer); pointerStart=null; }));
 bubble.addEventListener('click',()=>{ if(holdActive) { holdActive=false; return; } setScene('chat'); });
 bubble.addEventListener('contextmenu',event=>{ event.preventDefault(); holdActive=true; $('hide-bubble').hidden=false; $('hold-hint').hidden=false; $('unread-count').hidden=true; });
 bubble.addEventListener('keydown',event=>{ if(event.key==='Delete'||event.key==='Backspace') { event.preventDefault(); $('hide-bubble').hidden=false; $('hold-hint').hidden=false; $('hide-bubble').focus(); } });
 $('hide-bubble').addEventListener('click',()=>{ hiddenBubble=true; setScene('closed'); document.querySelector('[data-scene="settings"]').focus(); });
 $('toast-open').addEventListener('click',()=>toastAction?.());
 $('toast-dismiss').addEventListener('click',()=>$('site-toast').hidden=true);
 renderThread();
 const initial=new URLSearchParams(location.search).get('state')||'chat';
 setScene(['chat','closed','alerts','settings'].includes(initial)?initial:'chat',{focus:false});
})();
