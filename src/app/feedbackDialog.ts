/** "Exportera feedback (lokalt)": shows exactly what would be saved, lets the artist add a note, and saves a file only on their own click. Nothing is sent. */
import { desktop } from './desktop';

export async function openFeedbackDialog(): Promise<void> {
  const host = desktop?.feedback;
  if (!host) return;
  const dlg = document.createElement('dialog'); dlg.id = 'feedback-dialog'; dlg.setAttribute('aria-label', 'Export feedback');
  dlg.style.cssText = 'width:min(640px,92vw);max-height:86vh;overflow:auto;background:#1b2128;color:#eee;border:1px solid #5a6a78;border-radius:8px;padding:14px';
  const h = document.createElement('h2'); h.textContent = 'Export feedback (local)';
  const intro = document.createElement('p'); intro.textContent = 'This creates a file that you read first yourself and choose where to save yourself. Nothing is sent by NOEMA. No scenes, pictures, AI conversations, paths or keys are included.';
  const note = document.createElement('textarea'); note.rows = 3; note.maxLength = 2000; note.style.cssText = 'width:100%;box-sizing:border-box'; note.placeholder = 'Optional: what happened, and what had you hoped for?'; note.setAttribute('aria-label', 'Your note (optional)');
  const pre = document.createElement('pre'); pre.style.cssText = 'max-height:34vh;overflow:auto;background:#10151a;padding:8px;font-size:12px;white-space:pre-wrap;word-break:break-word'; pre.setAttribute('aria-label', 'Preview of exactly what is saved');
  const status = document.createElement('small'); status.setAttribute('role', 'status');
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save to file…';
  const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close';
  const refresh = async (): Promise<void> => { try { pre.textContent = await host.preview(note.value); } catch { pre.textContent = 'Could not create the preview.'; } };
  note.oninput = () => void refresh();
  save.onclick = async () => { try { const r = await host.save(pre.textContent ?? ''); status.textContent = r.saved ? 'Saved. You decide yourself whether to share the file.' : 'No file was saved.'; } catch (e) { status.textContent = 'Could not save.'; } };
  close.onclick = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.append(h, intro, note, pre, save, close, status);
  document.body.append(dlg); dlg.showModal(); await refresh();
}
