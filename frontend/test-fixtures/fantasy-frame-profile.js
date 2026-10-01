// Isolated real-shell QA. Neither delayed frames nor blocking work ships in the app.
const params = new URLSearchParams(location.search);
const delay = params.get("slowFrames") === "1" ? 1000 : 0;
if (delay) {
  const nativeFrame = window.requestAnimationFrame.bind(window);
  const cancelNative = window.cancelAnimationFrame.bind(window);
  const pending = new Map();
  let nextId = 0;
  window.requestAnimationFrame = callback => {
    const id = ++nextId, task = {};
    task.timer = setTimeout(() => { task.frame = nativeFrame(time => {pending.delete(id); callback(time);}); }, delay);
    pending.set(id, task);
    return id;
  };
  window.cancelAnimationFrame = id => {
    const task = pending.get(id);
    if (!task) return;
    clearTimeout(task.timer);
    if (task.frame !== undefined) cancelNative(task.frame);
    pending.delete(id);
  };
}
document.body.dataset.fixtureFrameDelayMs = String(delay);
import("./fantasy-bootstrap.jsx");
// A deliberate frame callback validates real browser script attribution.
const button = document.createElement("button");
button.textContent = "Run 200 ms blocking task (QA)";
button.style.minHeight = "44px";
button.style.minWidth = "44px";
button.addEventListener("click", () => {
  button.disabled = true;
  requestAnimationFrame(() => {
    const until = performance.now() + 200;
    while (performance.now() < until) { /* synthetic CPU work */ }
    button.textContent = "Blocking task finished (QA)";
    requestAnimationFrame(() => { button.dataset.blockingFrameComplete = "true"; });
  });
});
document.body.append(button);
