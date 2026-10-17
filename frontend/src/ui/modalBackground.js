// Preserve the original page state until the last modal closes, in any order.
const documents = new WeakMap();

export function lockModalBackground(root) {
  const doc = root.ownerDocument;
  let state = documents.get(doc);
  if (!state) {
    state = { layers: [], background: new Map(), overflow: doc.body.style.overflow };
    documents.set(doc, state);
  }
  const layer = { root };
  const sync = () => {
    const top = state.layers.at(-1);
    for (const element of doc.body.children) {
      if (!state.background.has(element)) state.background.set(element, element.inert);
      element.inert = state.background.get(element) || !element.contains(top.root);
    }
    doc.body.style.overflow = "hidden";
  };
  state.layers.push(layer);
  sync();
  return {
    isTop: () => state.layers.at(-1) === layer,
    release() {
      const index = state.layers.indexOf(layer);
      if (index < 0) return;
      state.layers.splice(index, 1);
      if (state.layers.length) sync();
      else {
        for (const [element, inert] of state.background) element.inert = inert;
        doc.body.style.overflow = state.overflow;
        documents.delete(doc);
      }
    },
  };
}
