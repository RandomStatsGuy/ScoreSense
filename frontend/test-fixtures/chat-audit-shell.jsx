// Optional synthetic chat context for existing real-component fixtures.
import React from "react";
import {MemoryRouter} from "react-router-dom";
import MobileShell from "../src/layout/MobileShell";
import {CommunicationProvider} from "../src/DraftHub/CommunicationContext";
import ChatLauncher from "../src/DraftHub/ChatLauncher";
import CommunicationPanel from "../src/DraftHub/CommunicationPanel";
import "../src/styles/fantasy-chat.css";
import "../src/styles/color-theme.css";

export function ChatAuditShell({children,router=false,shell=false,main=false}) {
  if(!new URLSearchParams(location.search).has("chat"))return children;
  if(!window.chatAuditWrites){
    window.chatAuditWrites=[];
    const fetchFixture=window.fetch;
    window.fetch=(input,options={})=>{
      const url=new URL(typeof input==="string"?input:input.url,location.origin);
      if(url.pathname.startsWith("/api/") && (options.method||"GET")!=="GET"){
        window.chatAuditWrites.push(url.pathname);
        return Promise.resolve(Response.json({detail:"Chat audit forbids writes"},{status:409}));
      }
      if(url.pathname.includes("/chat/"))return Promise.resolve(Response.json({threads:[],members:[],notifications:[],preferences:{},unread:0,messages:[]}));
      return fetchFixture(input,options);
    };
  }
  const content=main?<main id="main-content">{children}</main>:children;
  const dock=<><ChatLauncher leagueId="fixture"/><CommunicationPanel/></>;
  const body=shell?<MobileShell section="hub" onSectionChange={()=>{}} onMoreOpen={()=>{}} hrefForSection={id=>`#${id}`}>{content}{dock}</MobileShell>:<>{content}{dock}</>;
  const tree=<CommunicationProvider enabled identity="chat-audit" hubContext={{mode:"league",league_id:"fixture",team_id:"mine"}}>{body}</CommunicationProvider>;
  return router?<MemoryRouter>{tree}</MemoryRouter>:tree;
}
