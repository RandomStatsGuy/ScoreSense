function setScenario(scenario) {
  const pre = scenario === 'pre';
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.scenario === scenario)));
  document.querySelectorAll('[data-season-only]').forEach(el => el.hidden = pre);
  document.querySelectorAll('[data-pre-only]').forEach(el => el.hidden = !pre);
  document.querySelectorAll('.phase-track span').forEach(el => {
    if (el.dataset.phase === (pre ? 'pre' : 'season')) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
  });
}
document.querySelectorAll('[data-scenario]').forEach(button => button.addEventListener('click', () => setScenario(button.dataset.scenario)));
document.querySelector('.chat-compose').addEventListener('submit', event => { event.preventDefault(); });
setScenario('season');
