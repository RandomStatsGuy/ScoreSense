/* Navigation feedback only. Native details own disclosure and keyboard behavior. */
let previewToastTimer;
document.addEventListener('click', event => {
  const link = event.target.closest('[data-preview]');
  if (!link) return;
  event.preventDefault();
  const toast = document.getElementById('preview-toast');
  if (!toast) return;
  toast.textContent = `Preview destination: ${link.dataset.preview}. Sample data; no league changes.`;
  toast.hidden = false;
  clearTimeout(previewToastTimer);
  previewToastTimer = setTimeout(() => toast.hidden = true, 3500);
});
