import React from "react";
import MobileBottomSheet from "./MobileBottomSheet";
import { selectAndDismissDestination } from "./mobileChromePresentation";

export default function MobileDestinationSheet({
  open,
  onClose,
  title,
  lead = null,
  groups = [],
  active,
  onSelect,
  className = "",
}) {
  return (
    <MobileBottomSheet
      open={open}
      onClose={onClose}
      title={title}
      className={`app-mobile-sheet-destinations ${className}`.trim()}
    >
      {lead}
      <div className="app-mobile-sheet-list">
        {groups.map((group) => (
          <React.Fragment key={group.id || group.label || "group"}>
            {group.label ? <p className="app-mobile-sheet-group">{group.label}</p> : null}
            {(group.items || []).map((item) => (
              <button
                key={item.id}
                type="button"
                className={`app-mobile-sheet-item app-mobile-sheet-item-subdued app-mobile-sheet-item--dest${active === item.id ? " active" : ""}`}
                onClick={() => selectAndDismissDestination(item.id, onSelect, onClose)}
              >
                <span>{item.label}</span>
                {item.hint ? <span className="chart-note">{item.hint}</span> : null}
              </button>
            ))}
          </React.Fragment>
        ))}
      </div>
    </MobileBottomSheet>
  );
}
