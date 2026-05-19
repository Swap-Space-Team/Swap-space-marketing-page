// js/modal.js — promise-based confirm dialog over the #confirmModal element.
// (Additive helper, not in the spec file list — documented in README.)

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  okLabel = 'Confirm',
  okClass = 'btn-danger',
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('confirmModal');
    const ok = document.getElementById('confirmOk');
    const cancel = document.getElementById('confirmCancel');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    ok.textContent = okLabel;
    ok.className = `btn ${okClass}`;

    const close = (result) => {
      overlay.classList.add('hidden');
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      overlay.removeEventListener('click', onBackdrop);
      resolve(result);
    };
    const onOk = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e) => {
      if (e.target === overlay) close(false);
    };

    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    overlay.addEventListener('click', onBackdrop);
    overlay.classList.remove('hidden');
  });
}
