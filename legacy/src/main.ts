import './style.css';
const isLab = () => location.hash.startsWith('#/lab');
const startedInLab = isLab();
// Crossing page boundaries reloads the document, releasing all aquarium listeners and GPU resources.
// Bench/level navigation stays within the single Lab renderer.
let disposeLab: (() => void) | undefined;
addEventListener('hashchange', () => {
  if (isLab() !== startedInLab) { disposeLab?.(); location.reload(); }
});
if (startedInLab) {
  if (/^#\/lab\/?(?:\?|$)/.test(location.hash)) history.replaceState(null, '', '#/lab/terrain?level=1');
  import('./lab').then(async ({ bootLab }) => { disposeLab = await bootLab(); }).catch(error => {
    const loading = document.querySelector<HTMLElement>('#loading')!; loading.hidden = false; loading.textContent = `The Lab requires WebGPU: ${error.message}`;
    document.documentElement.dataset.status = 'error'; console.error(error);
  });
} else {
  const link = document.createElement('a'); link.className = 'enter-lab'; link.href = '#/lab/terrain?level=1'; link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3h6m-5 0v7L4 19q-1 2 2 2h12q3 0 2-2l-6-9V3M8 15h8"/></svg> Enter the Lab'; document.body.append(link);
  void import('./aquarium');
}
