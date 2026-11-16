/**
 * The "AI-brygga" panel (MCP-01): switch the bridge on and off, see the AI's drafts, and decide. Everything the AI does is
 * visible here; the live scene changes only when the artist presses "Använd". Swedish text; controls carry "AI-brygga" in their
 * label so Ctrl+K finds them. The bridge is OFF until the artist presses the switch, and "Stoppa AI" closes it at once.
 */
import { LOCK_LABELS, lockedKeys } from '../../engine/draftLocks';
import { changeSentence } from './changeLabels';
import type { AiBridgeState, AiHost } from '../desktop';
import type { AppService, DraftView } from './appService';
import { stateText } from './drafts';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (className) e.className = className;
  return e;
};
const shown = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

/** The JSON an artist pastes into an MCP host (for example Claude Desktop's configuration file). */
export function mcpConfigJson(state: Pick<AiBridgeState, 'endpointFile' | 'shimPath'>): string {
  return JSON.stringify({ mcpServers: { 'noema-fractal': { command: 'node', args: [state.shimPath ?? '<path to tools/noema-mcp/server.mjs>'], env: { NOEMA_AI_ENDPOINT: state.endpointFile } } } }, null, 2);
}

export class AiPanel {
  private details = el('details', undefined, 'ai-bridge-panel');
  private status = el('div', 'AI bridge: off', 'ai-bridge-status');
  private toggle = el('button', 'Turn on the AI bridge');
  private info = el('small', undefined, 'ai-bridge-info');
  private config = el('div', undefined, 'ai-bridge-config');
  private drafts = el('div', undefined, 'ai-bridge-drafts');
  private log = el('div', undefined, 'ai-bridge-log');
  private state: AiBridgeState | null = null;
  private expanded = new Set<string>();
  private notes = new Map<string, string>();

  constructor(root: HTMLElement, private service: AppService, private host: AiHost) {
    this.details.id = 'ai-bridge-panel';
    const summary = el('summary', 'AI bridge (optional)');
    this.toggle.type = 'button';
    this.toggle.setAttribute('aria-label', 'AI bridge: turn on or stop');
    this.toggle.title = 'AI bridge: lets an AI host (for example Claude Desktop) create and preview drafts. Off by default.';
    this.info.textContent = 'Off by default. When it is on, an AI that you have connected yourself can read your settings and formulas, create separate drafts, change them and draw small previews. Your scene only changes when you press Use, and then you can undo. Everything the AI does is shown here.';
    this.details.append(summary, this.status, this.toggle, this.info, this.config, el('h4', 'Drafts from the AI'), this.drafts, el('h4', 'Log'), this.log);
    root.append(this.details);
    this.toggle.onclick = () => void this.flip();
    host.onState((s) => { this.state = s; this.draw(); });
    service.onChange(() => this.draw());
    void host.status().then((s) => { this.state = s; this.draw(); }, () => this.draw());
    this.draw();
  }

  private async flip(): Promise<void> {
    this.toggle.disabled = true;
    try { this.state = this.state?.running ? await this.host.disable() : await this.host.enable(); }
    catch (e) { this.notes.set('', e instanceof Error ? e.message : String(e)); }
    this.toggle.disabled = false;
    this.draw();
  }

  private draw(): void {
    const s = this.state, on = !!s?.running;
    this.details.classList.toggle('on', on);
    // The MCP shim opens one short connection per call, so "connected" is not a steady state; show when the AI last did something.
    const last = [...this.service.actionLog].reverse().find((e) => !e.op.startsWith('artist.'));
    this.status.textContent = on ? `AI bridge: ON – ${last ? `latest AI call ${new Date(last.time).toLocaleTimeString('en-GB')} (${last.op})` : 'waiting for an AI host to connect'}` : 'AI bridge: off';
    this.toggle.textContent = on ? 'Stop the AI' : 'Turn on the AI bridge';
    this.toggle.setAttribute('aria-label', on ? 'AI bridge: stop the AI' : 'AI bridge: turn on');
    this.drawConfig(s);
    this.drawDrafts();
    this.drawLog();
  }

  private drawConfig(s: AiBridgeState | null): void {
    this.config.replaceChildren();
    if (!s) return;
    this.config.append(el('small', `Connection (MCP, stdio): ${s.shimPath ?? 'the MCP shim is not included in this installation'}`));
    const copy = el('button', 'Copy MCP configuration');
    copy.type = 'button';
    copy.setAttribute('aria-label', 'AI bridge: copy MCP configuration');
    copy.title = 'AI bridge: copies JSON to paste into the MCP settings of the AI host (for example Claude Desktop claude_desktop_config.json)';
    copy.onclick = () => { void navigator.clipboard?.writeText(mcpConfigJson(s)).then(() => { copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy MCP configuration'), 1500); }, () => { copy.textContent = 'Could not copy'; }); };
    this.config.append(copy);
    const err = this.notes.get('');
    if (err) this.config.append(el('div', err, 'ai-bridge-error'));
  }

  private drawDrafts(): void {
    const views = this.service.draftViews();
    this.drafts.replaceChildren();
    this.drawRecovery();
    if (!views.length) { this.drafts.append(el('small', 'No drafts yet.')); return; }
    for (const v of views) this.drafts.append(this.card(v));
  }

  /** Shown after a restart: what came back from disk, what could not be read, and a disk error if saving fails. */
  private drawRecovery(): void {
    const r = this.service.recovery;
    if (r.restored > 0 || r.problems.length || r.warnings.length) {
      const box = el('div', undefined, 'ai-bridge-recovery');
      if (r.restored > 0) box.append(el('strong', `${r.restored} drafts were restored from last time. They have not been applied to your scene – choose Use, Reject or Discard for each one.`));
      for (const w of r.warnings) box.append(el('small', w));
      for (const p of r.problems) box.append(el('div', `A saved draft (${p.id}) could not be read completely: ${p.reason}`, 'ai-bridge-warning'));
      const ok = el('button', 'Noted'); ok.type = 'button';
      ok.setAttribute('aria-label', 'AI bridge: hide the restore message');
      ok.onclick = () => this.service.acknowledgeRecovery();
      box.append(ok);
      this.drafts.append(box);
    }
    if (r.diskError) this.drafts.append(el('div', r.diskError, 'ai-bridge-error'));
  }

  private card(v: DraftView): HTMLElement {
    const card = el('div', undefined, 'ai-draft ' + v.state);
    const awaiting = v.state === 'awaiting_user_confirmation';
    card.append(el('strong', `${v.label} – ${stateText(v.state)}`), el('small', `${v.changes} changes · ${v.previews} previews`));
    if (v.source?.kind === 'artwork') card.append(el('small', `From the artwork: ${v.source.title ?? v.source.id}. The original is never changed. Use replaces your current scene (can be undone).`));
    if (v.recovered) card.append(el('small', 'Restored after restart.'));
    if (v.locks && lockedKeys(v.locks).length) { const lk = el('small', 'Locked: ' + lockedKeys(v.locks).map((k) => LOCK_LABELS[k]).join(', ') + ' (cannot be changed in the draft)', 'ai-draft-locks'); lk.dataset.draftLocks = lockedKeys(v.locks).join(','); card.append(lk); }
    if (v.requestMessage) card.append(el('div', `AI:n skriver: ${v.requestMessage}`, 'ai-draft-message'));
    const open = v.state === 'editing' || awaiting;
    if (open && v.liveSceneChangedSinceDraft) card.append(el('div', 'Note: your scene has changed since the draft was created.', 'ai-bridge-warning'));
    const note = this.notes.get(v.draft_id);
    if (note) card.append(el('div', note, 'ai-bridge-warning'));
    const row = el('div', undefined, 'ai-draft-buttons');
    const apply = el('button', awaiting ? 'Use' : 'Use right now');
    apply.type = 'button'; apply.disabled = !open || v.changes === 0;
    apply.setAttribute('aria-label', `AI bridge: use the draft ${v.label}`);
    apply.onclick = () => {
      const r = this.service.confirmApply(v.draft_id);
      if (!r.ok) this.notes.set(v.draft_id, r.message); else this.notes.delete(v.draft_id);
      if (!r.ok && r.code === 'conflict') this.force(v.draft_id); else this.draw();
    };
    const decline = el('button', 'Avvisa'); decline.type = 'button'; decline.disabled = !open;
    decline.setAttribute('aria-label', `AI bridge: reject the draft ${v.label}`);
    decline.onclick = () => { this.service.declineDraft(v.draft_id); this.draw(); };
    const view = el('button', this.expanded.has(v.draft_id) ? 'Hide changes' : 'Show changes'); view.type = 'button';
    view.setAttribute('aria-label', `AI bridge: show changes in ${v.label}`);
    view.onclick = () => { this.expanded.has(v.draft_id) ? this.expanded.delete(v.draft_id) : this.expanded.add(v.draft_id); this.draw(); };
    const discard = el('button', 'Discard'); discard.type = 'button';
    discard.setAttribute('aria-label', `AI bridge: discard the draft ${v.label}`);
    discard.title = 'Deletes the draft for good (your artworks and your scene are not touched).';
    discard.onclick = () => { this.service.discardFromUi(v.draft_id); this.draw(); };
    row.append(apply, decline, view, discard);
    card.append(row);
    if (this.expanded.has(v.draft_id)) {
      const list = el('ul', undefined, 'ai-draft-diff');
      const diff = this.service.draftChanges(v.draft_id);
      for (const e of diff.entries) list.append(el('li', changeSentence(e)));
      if (diff.total > diff.entries.length) list.append(el('li', `… and ${diff.total - diff.entries.length} more`));
      if (!diff.total) list.append(el('li', 'No changes.'));
      card.append(list);
    }
    return card;
  }

  /** The artist saw the conflict message and may insist. */
  private force(id: string): void {
    this.draw();
    const again = el('button', 'Use anyway (replaces your later changes, can be undone)');
    again.type = 'button';
    again.setAttribute('aria-label', 'AI bridge: use the draft anyway');
    again.onclick = () => { this.service.confirmApply(id, { force: true }); this.notes.delete(id); this.draw(); };
    this.drafts.append(again);
  }

  private drawLog(): void {
    this.log.replaceChildren();
    const entries = this.service.actionLog.slice(-15).reverse();
    if (!entries.length) { this.log.append(el('small', 'Nothing has happened.')); return; }
    const clear = el('button', 'Clear log'); clear.type = 'button';
    clear.setAttribute('aria-label', 'AI bridge: clear the log');
    clear.onclick = () => { this.service.actionLog.length = 0; this.draw(); };
    const list = el('ul');
    for (const e of entries) list.append(el('li', `${new Date(e.time).toLocaleTimeString('en-GB')} ${e.op} – ${e.summary}`));
    this.log.append(clear, list);
  }
}
