import React from "react";
import {PROJECTION_POSITIONS} from "../projectionsPresentation";

export default function ProjectionPositionControl({position,onChange,className=""}) {
  return <div className={className} role="radiogroup" aria-label="Position">
    {PROJECTION_POSITIONS.map((item,index)=><button key={item.id} type="button" role="radio"
      className={`tab header-segment-tab ${position===item.id?"active":""}`}
      aria-checked={position===item.id} tabIndex={position===item.id?0:-1}
      onClick={()=>onChange?.(item.id)} onKeyDown={event=>{
        const next=event.key==="ArrowRight"||event.key==="ArrowDown"?index+1
          :event.key==="ArrowLeft"||event.key==="ArrowUp"?index-1
          :event.key==="Home"?0:event.key==="End"?PROJECTION_POSITIONS.length-1:null;
        if(next==null)return;
        event.preventDefault();
        const target=(next+PROJECTION_POSITIONS.length)%PROJECTION_POSITIONS.length;
        onChange?.(PROJECTION_POSITIONS[target].id);
        event.currentTarget.parentElement.querySelectorAll('[role="radio"]')[target]?.focus();
      }}>{item.label}</button>)}
  </div>;
}
