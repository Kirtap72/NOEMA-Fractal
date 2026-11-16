/**
 * The in-app AI chat (MCP-02, extended in AI-COCREATION-01): a visible, collaborative workflow with the AI of the artist's choice.
 * All the work (network, keys, the model loop) happens in the main process; this panel sends text, an optional reference picture and
 * options, and draws what comes back: progress, the latest preview large, a plain explanation, the real list of changes, and the
 * buttons Fortsätt / Byt riktning / Skapa variation / Använd / Släng. It never sees an API key.
 * The AI works on drafts; "Använd" is the artist's own button and the only way the live scene changes (one Undo-able step).
 */
import type { AiChatConfig, AiChatModel, AiHost } from '../desktop';
import type { AppService } from './appService';
import { changeSentence } from './changeLabels';
import { RegionPanel } from './regionPanel';
import type { RegionPort } from './regionPanel';
import { composeBrief, describeBrief } from './regionBrief';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const store = {
  get(k: string): string | null { try { return localStorage.getItem('noema.aiChat.' + k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem('noema.aiChat.' + k, v); } catch { /* optional convenience */ } },
};

const MODE_HELP: Record<string, string> = {
  create: 'The AI works on its own in its draft: tries ideas, looks at the pictures and shows its best version.',
  explore: 'The AI explores the shape itself: tries different formula chains in 2–3 drafts, compares previews and explains which geometric idea each draft tests.',
  together: 'You take turns: the AI makes one or two changes, shows them and asks what to do next.',
  teach: 'The AI explains without changing anything. Press "Show as example" if you want to see a small example in a draft.',
};
const STAGES = [['understand', 'Understands'], ['edit', 'Edits the draft'], ['render', 'Draws a preview'], ['review', 'Reviews the result']] as const;
type Stage = (typeof STAGES)[number][0];
const EDIT_TOOLS = /^noema_(create_draft|set_draft_|apply_material|undo_draft|request_apply)/;
const BUDGET_FIELDS: { key: string; label: string; step: string; scale?: number; cost?: boolean }[] = [
  { key: 'toolCalls', label: 'At most tool calls', step: '1' },
  { key: 'previews', label: 'At most previews', step: '1' },
  { key: 'seconds', label: 'At most minutes', step: '0.5', scale: 60 },
  { key: 'tokens', label: 'At most tokens (thousands)', step: '10', scale: 1000 },
  { key: 'costUSD', label: 'At most cost (USD)', step: '0.05', cost: true },
];
const MAX_REFERENCE_SIDE = 768;

export class AiChatPanel {
  private details = el('details', undefined, 'ai-chat-panel');
  private note = el('small', undefined, 'ai-chat-note');
  private provider = el('select');
  private model = el('select');
  private keyInfo = el('small');
  private keyBox = el('div', undefined, 'ai-chat-key');
  private modes = el('div', undefined, 'ai-chat-modes');
  private modeHelp = el('small');
  private budgetBox = el('details');
  private progress = el('ol', undefined, 'ai-chat-progress');
  private stage = el('figure', undefined, 'ai-chat-stage');
  private bigPreview = el('img', undefined, 'ai-chat-big');
  private caption = el('figcaption');
  private thumbs = el('div', undefined, 'ai-chat-thumbs');
  private explain = el('div', undefined, 'ai-chat-explain');
  private actions = el('div', undefined, 'ai-chat-actions');
  private log = el('div', undefined, 'ai-chat-log');
  private refRow = el('div', undefined, 'ai-chat-ref');
  private input = el('textarea');
  private send = el('button', 'Send');
  private stop = el('button', 'Stop');
  private reset = el('button', 'New conversation');
  private status = el('small', undefined, 'ai-chat-status');
  private config: AiChatConfig | null = null;
  private budgetInputs = new Map<string, HTMLInputElement>();
  private mode = store.get('mode') ?? 'create';
  private running = false;
  private currentStage: Stage | null = null;
  private reference: { mime: string; base64: string; name: string } | null = null;
  private referenceSent = false;
  private lastExplanation = '';
  private entries: { who: string; text: string }[] = [];
  private previews: { src: string; label: string }[] = [];
  private armed: 'apply' | null = null;
  private armTimer: number | undefined;
  private conflict: string | null = null;

  /** The marked region as it was sent with the last message: the anchor the alternatives are compared against in the picture strip. */
  private regionAnchor: { src: string; label: string } | null = null;
  private regionPanel: RegionPanel;

  constructor(root: HTMLElement, private host: AiHost, private service?: AppService, regionPort?: RegionPort) {
    this.regionPanel = new RegionPanel(regionPort);
    this.details.id = 'ai-chat-panel';
    this.details.open = true;
    const summary = el('summary', 'Conversation with AI');
    this.note.textContent = 'Write what you want to see, in your own words. The AI only changes separate drafts and looks at small previews. Your scene only changes when you press Use yourself, and then you can undo. The app works exactly as before without the AI.';
    const row = (label: string, ...nodes: HTMLElement[]): HTMLElement => { const r = el('div', undefined, 'ai-chat-row'); r.append(el('label', label), ...nodes); return r; };
    this.provider.setAttribute('aria-label', 'AI chat: provider');
    this.model.setAttribute('aria-label', 'AI chat: model');
    const refresh = el('button', 'Refresh'); refresh.type = 'button';
    refresh.setAttribute('aria-label', 'AI chat: refresh the model list');
    refresh.onclick = () => void this.loadModels(true);
    const modelRow = row('Model', refresh, this.model); modelRow.classList.add('ai-chat-model-row');
    this.input.rows = 3; this.input.placeholder = 'For example: make the picture warmer and more dramatic. Or reply to the last picture: "less metal, more organic".';
    this.input.setAttribute('aria-label', 'AI chat: your message');
    this.input.maxLength = 4000;
    for (const b of [this.send, this.stop, this.reset]) b.type = 'button';
    this.send.setAttribute('aria-label', 'AI chat: send'); this.stop.setAttribute('aria-label', 'AI chat: stop the AI'); this.reset.setAttribute('aria-label', 'AI chat: start a new conversation');
    this.send.onclick = () => void this.submit(this.input.value);
    this.stop.onclick = () => void this.host.chat.cancel();
    this.reset.onclick = async () => {
      if (await this.host.chat.reset()) { this.entries = []; this.log.replaceChildren(); this.previews = []; this.lastExplanation = ''; this.reference = null; this.referenceSent = false; this.regionPanel.resetRegion(); this.regionAnchor = null; this.drawStage(); this.drawRef(); this.drawExplain(); this.say('system', 'New conversation. Your drafts remain in the AI bridge.'); }
      else this.status.textContent = 'Wait until the AI is finished or press Stop first.';
    };
    this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void this.submit(this.input.value); } });
    this.budgetBox.append(el('summary', 'Budget (so that the AI does not run away)'));
    this.progress.setAttribute('aria-label', 'AI chat: progress'); this.progress.setAttribute('aria-live', 'polite');
    for (const [id, label] of STAGES) { const li = el('li', label); li.dataset.stage = id; this.progress.append(li); }
    this.bigPreview.alt = 'Latest preview from the AI'; this.bigPreview.hidden = true;
    this.stage.append(this.bigPreview, this.caption, this.thumbs);
    this.explain.setAttribute('aria-live', 'polite');
    // Poly Haven for the AI is OFF at every start; this switch is the artist's session permission (with fixed quotas, enforced by the service).
    const ph = document.createElement('label'); ph.className = 'ai-chat-polyhaven';
    const phBox = document.createElement('input'); phBox.type = 'checkbox'; phBox.setAttribute('aria-label', 'Let the AI search and fetch Poly Haven materials during this session');
    const phText = document.createElement('span'); phText.textContent = ' Let the AI search and fetch Poly Haven materials (at most 20 searches and 6 downloads per session; nothing about you is sent)';
    phBox.onchange = () => { this.service?.setPolyHavenAccess(phBox.checked); };
    ph.append(phBox, phText); if (!this.service) ph.hidden = true;
    // Own works for the AI is OFF at every start: only counts of which formulas and pairs the artist has used are shared with the model, never pictures or parameters.
    const ow = document.createElement('label'); ow.className = 'ai-chat-polyhaven';
    const owBox = document.createElement('input'); owBox.type = 'checkbox'; owBox.setAttribute('aria-label', 'Let the AI see statistics about my own artworks during this session');
    const owText = document.createElement('span'); owText.textContent = ' Let the AI see statistics about my own artworks (only how often formulas are used, never pictures or values; everything stays on the computer)';
    owBox.onchange = () => { this.service?.setOwnWorksAccess(owBox.checked); };
    ow.append(owBox, owText); if (!this.service) ow.hidden = true;
    service?.onChange(() => { phBox.checked = service.polyHavenAccess.allowed; owBox.checked = service.ownWorksAccess.allowed; });
    this.details.append(summary, this.note, ph, ow, row('Provider', this.provider), this.keyInfo, this.keyBox, modelRow, this.modes, this.modeHelp, this.budgetBox,
      this.progress, this.stage, this.explain, this.actions, this.log, this.refRow, this.regionPanel.root, this.input, row('', this.send, this.stop, this.reset), this.status);
    root.append(this.details);
    this.provider.onchange = () => { store.set('provider', this.provider.value); this.drawKey(); void this.loadModels(false).then(() => this.persist()); };
    this.model.onchange = () => { store.set('model:' + this.provider.value, this.model.value); this.persist(); };
    host.chat.onEvent((e) => this.onEvent(e));
    service?.onChange(() => this.drawActions());
    this.drawStage(); this.drawRef(); this.drawExplain();
    void this.init();
    this.setRunning(false);
  }

  // ---- start-up --------------------------------------------------------------------------------------------------------------------------

  private async init(): Promise<void> {
    try { this.config = await this.host.chat.config(); } catch { this.config = { available: false, reason: 'The chat is not responding.' }; }
    const c = this.config!;
    if (!c.available) { this.note.textContent = `The AI chat is not available here: ${c.reason ?? 'unknown reason'}. The app works as usual.`; this.send.disabled = true; return; }
    for (const p of c.providers ?? []) { const o = el('option', p.label); o.value = p.id; this.provider.append(o); }
    let session: Awaited<ReturnType<AiHost['chat']['loadSession']>> = null;
    try { session = await this.host.chat.loadSession(); } catch { session = null; }
    const wantProvider = session?.ui.provider ?? store.get('provider');
    this.provider.value = wantProvider && (c.providers ?? []).some((p) => p.id === wantProvider) ? wantProvider : c.defaultProvider ?? this.provider.value;
    for (const m of c.modes ?? []) {
      const b = el('button', m.title); b.type = 'button'; b.dataset.mode = m.id;
      b.setAttribute('aria-label', `AI chat: mode ${m.title}`);
      b.onclick = () => { this.mode = m.id; store.set('mode', m.id); this.drawMode(); this.persist(); };
      this.modes.append(b);
    }
    if (session?.ui.mode && (c.modes ?? []).some((m) => m.id === session!.ui.mode)) this.mode = session.ui.mode;
    if (!(c.modes ?? []).some((m) => m.id === this.mode)) this.mode = c.modes?.[0]?.id ?? 'create';
    this.drawMode(); this.drawKey(); this.drawBudget();
    await this.loadModels(false, session?.ui.model);
    this.setRunning(false); // the buttons were disabled until the configuration arrived
    if (session) {
      this.entries = session.ui.log.slice(-200);
      for (const e of this.entries) this.append(e.who as 'user', e.text);
      this.lastExplanation = session.ui.lastExplanation ?? '';
      this.say('system', session.engineRestored
        ? 'The last session was restored: the conversation and your drafts remain. Previews and reference pictures are not saved (they are private); ask for a new picture when needed.'
        : 'The last chat was restored as text. The memory of the AI of the conversation could not be loaded, so it starts without it; your drafts remain.', true);
      this.drawExplain();
    }
    this.drawActions();
  }

  private currentProvider() { return this.config?.providers?.find((p) => p.id === this.provider.value); }

  private keyOpen = false;
  private drawKey(): void {
    const p = this.currentProvider();
    if (!p) return;
    const stored = !!p.keyStatus?.stored;
    this.keyInfo.textContent = stored ? `${p.label} is connected: the key is saved encrypted by Windows for your account.` : p.hasKey ? `${p.label}: key found in the environment variable ${p.keyEnv}.` : `${p.label} is not connected yet.`;
    this.keyInfo.className = p.hasKey ? '' : 'ai-bridge-warning';
    this.keyBox.replaceChildren();
    const open = el('button', stored ? 'Change key' : `Connect ${p.label}`); open.type = 'button';
    open.setAttribute('aria-label', `AI chat: connect ${p.label}`); open.setAttribute('aria-expanded', String(this.keyOpen));
    open.onclick = () => { this.keyOpen = !this.keyOpen; this.drawKey(); };
    this.keyBox.append(open);
    if (this.keyOpen) {
      const form = el('div', undefined, 'ai-chat-keyform');
      const input = el('input'); input.type = 'password'; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = 'Paste your API key here';
      input.setAttribute('aria-label', `API key for ${p.label}`);
      const note = el('small', `The key is encrypted by Windows (only your account on this computer can read it), is never shown again and is only sent to ${p.label} when the AI works. It is not saved in any project files or logs.`);
      const msg = el('small', undefined, 'ai-chat-keymsg'); msg.setAttribute('role', 'status');
      const save = el('button', 'Save key'); save.type = 'button';
      save.onclick = async () => {
        save.disabled = true;
        try { const v = input.value; input.value = ''; await this.host.chat.keySet(p.id, v); await this.refreshConfig(); this.keyOpen = false; this.drawKey(); void this.loadModels(true); this.status.textContent = `${p.label} is connected.`; }
        catch (e) { msg.textContent = (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '').slice(0, 220); }
        save.disabled = false;
      };
      const test = el('button', 'Test connection'); test.type = 'button'; test.title = 'Sends a single very small request (a few tokens) to check that the key and the model work.';
      test.onclick = async () => { if (!this.model.value) { msg.textContent = 'Choose a model first.'; return; } test.disabled = true; msg.textContent = 'Testing…'; try { const r = await this.host.chat.keyTest(p.id, this.model.value); msg.textContent = r.message; } catch (e) { msg.textContent = 'The test could not be run.'; } test.disabled = false; };
      form.append(input, note, save, test);
      if (stored) {
        const drop = el('button', 'Remove saved key'); drop.type = 'button';
        drop.onclick = async () => { try { await this.host.chat.keyClear(p.id); await this.refreshConfig(); this.keyOpen = false; this.drawKey(); } catch (e) { msg.textContent = 'Could not remove the key.'; } };
        form.append(drop);
      }
      form.append(msg);
      this.keyBox.append(form);
    }
    this.drawBudget(); this.drawRef();
  }
  private async refreshConfig(): Promise<void> { try { const c = await this.host.chat.config(); if (c.available) this.config = c; } catch { /* keep the old configuration */ } }

  private drawMode(): void {
    for (const b of Array.from(this.modes.querySelectorAll('button'))) { const on = b.dataset.mode === this.mode; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); }
    this.modeHelp.textContent = MODE_HELP[this.mode] ?? '';
    this.drawBudget(); this.drawActions();
  }

  private drawBudget(): void {
    const c = this.config;
    if (!c?.defaults) return;
    const mode = c.modes?.find((m) => m.id === this.mode);
    const costKnown = this.currentProvider()?.costKnown ?? false;
    for (const e of Array.from(this.budgetBox.querySelectorAll('.ai-chat-budget'))) e.remove();
    this.budgetInputs.clear();
    const grid = el('div', undefined, 'ai-chat-budget');
    for (const f of BUDGET_FIELDS) {
      if (f.cost && !costKnown) continue; // Ollama Cloud is billed by plan, not per token: a cost limit would mean nothing
      const value = (mode?.budget[f.key] ?? c.defaults[f.key] ?? 0) / (f.scale ?? 1);
      const i = el('input'); i.type = 'number'; i.step = f.step; i.min = '0'; i.value = String(value);
      i.max = String((c.hardMax?.[f.key] ?? 1e9) / (f.scale ?? 1));
      i.setAttribute('aria-label', `AI chat: ${f.label}`);
      this.budgetInputs.set(f.key, i);
      const r = el('div', undefined, 'ai-chat-row'); r.append(el('label', f.label), i); grid.append(r);
    }
    if (!costKnown) grid.append(el('small', 'The cost per token is unknown for this provider (it is covered by your plan). Therefore only calls, pictures, time and tokens are limited.'));
    this.budgetBox.append(grid);
  }

  private async loadModels(force: boolean, prefer?: string): Promise<void> {
    const provider = this.provider.value;
    if (!provider) return;
    this.model.replaceChildren(); this.model.disabled = true;
    this.status.textContent = force ? 'Fetching the model list…' : '';
    let models: AiChatModel[] = [], note = '';
    try { const r = await this.host.chat.models(provider); models = r.models; note = r.note ?? ''; }
    catch (e) { note = e instanceof Error ? e.message : String(e); }
    for (const m of models) {
      const caps = m.capabilities ? ` – ${[m.capabilities.includes('tools') ? 'tools' : '', m.capabilities.includes('vision') ? 'picture' : ''].filter(Boolean).join(' + ') || 'unknown capability'}` : '';
      const o = el('option', `${m.recommended ? '★ ' : ''}${m.id}${caps}${m.available === false ? ' (not available right now)' : ''}`);
      o.value = m.id; o.disabled = m.available === false; this.model.append(o);
    }
    const remembered = prefer ?? store.get('model:' + provider);
    if (remembered && models.some((m) => m.id === remembered && m.available !== false)) this.model.value = remembered;
    this.model.disabled = this.running || !models.length;
    this.status.textContent = note || (models.length ? '' : 'No models were found.');
  }

  // ---- progress, preview, explanation -----------------------------------------------------------------------------------------

  private setStage(s: Stage | null, allDone = false): void {
    this.currentStage = s;
    const at = s ? STAGES.findIndex(([id]) => id === s) : -1;
    STAGES.forEach(([id], i) => {
      const li = this.progress.children[i] as HTMLElement;
      li.className = allDone || i < at ? 'done' : i === at ? 'active' : '';
      li.setAttribute('aria-current', i === at && !allDone ? 'step' : 'false');
    });
  }
  private drawStage(): void {
    this.setStage(null);
    const last = this.previews[this.previews.length - 1];
    this.bigPreview.hidden = !last;
    if (last) { this.bigPreview.src = last.src; this.caption.textContent = last.label; } else { this.bigPreview.removeAttribute('src'); this.caption.textContent = 'The previews of the AI are shown here. Write a wish below to begin.'; }
    this.thumbs.replaceChildren();
    if (this.regionAnchor) {
      const a = this.regionAnchor;
      const t = el('img', undefined, 'ai-chat-thumb ai-chat-anchor'); t.src = a.src; t.alt = a.label; t.title = a.label; t.tabIndex = 0; t.dataset.regionAnchor = '';
      const show = (): void => { this.bigPreview.hidden = false; this.bigPreview.src = a.src; this.caption.textContent = a.label; };
      t.onclick = show; t.onkeydown = (e) => { if (e.key === 'Enter') show(); };
      this.thumbs.append(t);
    }
    this.previews.slice(-8).forEach((p, i, arr) => {
      const t = el('img', undefined, 'ai-chat-thumb'); t.src = p.src; t.alt = p.label; t.title = p.label; t.tabIndex = 0;
      const show = (): void => { this.bigPreview.src = p.src; this.caption.textContent = p.label; };
      t.onclick = show; t.onkeydown = (e) => { if (e.key === 'Enter') show(); };
      if (i === arr.length - 1) t.classList.add('on');
      this.thumbs.append(t);
    });
  }

  private activeDraft(): { id: string; changes: number; state: string; label: string; source?: string } | null {
    const views = this.service?.draftViews().filter((v) => v.state === 'editing' || v.state === 'awaiting_user_confirmation') ?? [];
    if (!views.length) return null;
    const v = views.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
    return { id: v.draft_id, changes: v.changes, state: v.state, label: v.label, ...(v.source?.kind === 'artwork' ? { source: v.source.title ?? v.source.id } : {}) };
  }

  private drawExplain(): void {
    this.explain.replaceChildren();
    const d = this.activeDraft();
    if (!this.lastExplanation && !d) { this.explain.hidden = true; return; }
    this.explain.hidden = false;
    this.explain.append(el('strong', 'What the AI changed'));
    if (this.lastExplanation) this.explain.append(el('div', this.lastExplanation, 'ai-chat-explain-text'));
    if (d && this.service && d.changes > 0) {
      const diff = this.service.draftChanges(d.id);
      const list = el('ul', undefined, 'ai-chat-changes');
      for (const e of diff.entries.slice(0, 8)) list.append(el('li', changeSentence(e)));
      if (diff.total > 8) list.append(el('li', `… and ${diff.total - 8} more`));
      if (diff.total) { this.explain.append(el('small', `Actual changes in the draft "${d.label}" compared with your scene:`), list); }
    }
  }

  private drawActions(): void {
    this.actions.replaceChildren();
    const d = this.activeDraft();
    const mk = (label: string, aria: string, fn: () => void, enabled = true, cls = ''): HTMLButtonElement => {
      const b = el('button', label, cls); b.type = 'button'; b.setAttribute('aria-label', 'AI chat: ' + aria); b.disabled = !enabled || this.running; b.onclick = fn; this.actions.append(b); return b;
    };
    const can = !!this.config?.available;
    if (this.mode === 'teach') mk('Show as example', 'show a small example in a draft', () => void this.submit(this.input.value.trim() || 'Show a small example of what you just explained, in a draft.', true), can);
    mk('Continue', 'continue improving the draft', () => void this.submit('Continue improving the draft in the same direction. Make one more clear improvement.'), can && !!d);
    mk('Change direction', 'change direction', () => { if (!this.input.value.trim()) this.input.value = 'Change direction to: '; this.input.focus(); }, can && !!d);
    mk('Create variation', 'create a variation of the draft', () => void this.submit('Create a variation: make a new draft from the active draft (from = the id of that draft) and change something clear but keep the shape. The first draft must remain.'), can && !!d);
    const apply = mk(this.armed === 'apply' ? 'Confirm: replace my scene' : 'Use', 'use the draft on my scene', () => this.applyDraft(), !!d && d.changes > 0, 'ai-chat-apply');
    if (this.armed === 'apply') apply.title = 'Your scene is replaced by the draft. You can undo with Undo.';
    mk('Discard', 'discard the draft', () => { if (d) { this.service?.discardFromUi(d.id); this.say('system', `The draft "${d.label}" was discarded.`); this.persist(); this.drawExplain(); this.drawActions(); } }, !!d);
    if (this.conflict) {
      this.actions.append(el('div', this.conflict, 'ai-bridge-warning'));
      const force = el('button', 'Use anyway (replaces your later changes, can be undone)'); force.type = 'button';
      force.onclick = () => { if (d) { this.service?.confirmApply(d.id, { force: true }); this.conflict = null; this.say('system', 'The draft was used. Press Undo in the app to go back.'); this.drawExplain(); this.drawActions(); this.persist(); } };
      this.actions.append(force);
    }
    if (d) this.actions.append(el('small', d.source ? `Active draft: ${d.label} (copy of the artwork "${d.source}": the original is never changed; Use replaces your current scene).` : `Active draft: ${d.label}. Your scene is untouched until you press Use.`));
  }

  /** Two clicks on purpose: the first arms the button, the second applies (and can be undone with the app's own Undo). */
  private applyDraft(): void {
    const d = this.activeDraft();
    if (!d || !this.service) return;
    if (this.armed !== 'apply') {
      this.armed = 'apply'; window.clearTimeout(this.armTimer);
      this.armTimer = window.setTimeout(() => { this.armed = null; this.drawActions(); }, 6000);
      this.drawActions(); return;
    }
    window.clearTimeout(this.armTimer); this.armed = null;
    const r = this.service.confirmApply(d.id);
    if (r.ok) { this.conflict = null; this.say('system', `The draft "${d.label}" is now your scene. Press Undo in the app to go back.`); }
    else if (r.code === 'conflict') this.conflict = r.message;
    else this.say('system', r.message);
    this.persist(); this.drawExplain(); this.drawActions();
  }

  // ---- reference picture --------------------------------------------------------------------------------------------------------------

  private drawRef(): void {
    this.refRow.replaceChildren();
    const file = el('input'); file.type = 'file'; file.accept = 'image/png,image/jpeg,image/webp'; file.hidden = true;
    file.setAttribute('aria-label', 'AI chat: choose reference picture');
    file.onchange = () => { const f = file.files?.[0]; file.value = ''; if (f) void this.pickReference(f); };
    const pick = el('button', this.reference ? 'Change reference picture' : 'Choose reference picture…'); pick.type = 'button';
    pick.setAttribute('aria-label', 'AI chat: choose a picture as inspiration'); pick.onclick = () => file.click();
    this.refRow.append(file, pick);
    const target = this.currentProvider()?.label ?? 'chosen provider';
    if (this.reference) {
      const img = el('img', undefined, 'ai-chat-ref-thumb'); img.src = `data:${this.reference.mime};base64,${this.reference.base64}`; img.alt = 'Chosen reference picture';
      const drop = el('button', 'Remove'); drop.type = 'button'; drop.setAttribute('aria-label', 'AI chat: remove the reference picture');
      drop.onclick = () => { this.reference = null; this.drawRef(); };
      this.refRow.append(img, drop, el('small', `"${this.reference.name}" is sent to ${target} (a cloud service) only when you press Send. A downscaled copy is used; the original never leaves your computer and the picture is not saved.`));
    } else this.refRow.append(el('small', this.referenceSent ? 'The reference picture is sent and stays in the conversation until you start a new one.' : 'Optional: a picture as inspiration for composition, colours, materials and mood. The AI does not rebuild the exact 3D shape of the picture.'));
  }

  private async pickReference(file: File): Promise<void> {
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Choose a PNG, JPEG or WebP picture.');
      if (file.size > 25 * 1024 * 1024) throw new Error('The picture is too large (at most 25 MB).');
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_REFERENCE_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
      if (base64.length < 100) throw new Error('The picture could not be read.');
      this.reference = { mime: 'image/jpeg', base64, name: file.name.slice(0, 60) };
      this.referenceSent = false; this.status.textContent = '';
    } catch (e) { this.reference = null; this.status.textContent = e instanceof Error ? e.message : 'The picture could not be read.'; }
    this.drawRef();
  }

  // ---- sending ---------------------------------------------------------------------------------------------------------------------------

  private say(who: 'user' | 'ai' | 'system' | 'tool', text: string, silent = false): void {
    if (!silent) this.entries.push({ who, text });
    this.append(who, text);
  }
  private append(who: 'user' | 'ai' | 'system' | 'tool', text: string): void {
    const line = el('div', text, `ai-chat-${who}`);
    this.log.append(line); this.log.scrollTop = this.log.scrollHeight;
  }

  private setRunning(on: boolean): void {
    this.running = on;
    this.send.disabled = on || !this.config?.available; this.stop.disabled = !on; this.reset.disabled = on;
    this.provider.disabled = on; this.model.disabled = on || !this.model.options.length; this.input.disabled = on;
    for (const b of Array.from(this.modes.querySelectorAll('button'))) b.disabled = on;
    this.drawActions();
  }

  private budget(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const f of BUDGET_FIELDS) { const i = this.budgetInputs.get(f.key); const v = i ? Number(i.value) : NaN; if (Number.isFinite(v) && v > 0) out[f.key] = v * (f.scale ?? 1); }
    return out;
  }

  private persist(): void {
    const d = this.activeDraft();
    void this.host.chat.saveSession({ log: this.entries.slice(-200), mode: this.mode, provider: this.provider.value, model: this.model.value, ...(d ? { activeDraftId: d.id } : {}), lastExplanation: this.lastExplanation }).catch(() => {});
  }

  private async submit(text: string, allowDemo = false): Promise<void> {
    const body = text.trim();
    if (!body || this.running) return;
    if (!this.model.value) { this.status.textContent = 'Choose a model first.'; return; }
    // ARTIST-WORKFLOW 07: a marked region goes along as a small picture (first), the artist's locks are handed to the application, which enforces them in code.
    const crop = this.regionPanel.crop();
    const brief = { instruction: body, region: this.regionPanel.region(), locks: this.regionPanel.currentLocks(), alternatives: this.regionPanel.alternativeCount() };
    this.service?.setLocks(brief.locks);
    const pics = [...(crop ? [{ mime: crop.mime, base64: crop.base64 }] : []), ...(this.reference ? [{ mime: this.reference.mime, base64: this.reference.base64 }] : [])];
    const pictures = pics.length ? pics : undefined;
    const message = composeBrief(brief);
    this.say('user', `${describeBrief(brief)}${this.reference ? `\n[med referensbild: ${this.reference.name}]` : ''}`);
    this.input.value = ''; this.status.textContent = ''; this.conflict = null;
    this.setStage('understand'); this.setRunning(true);
    const d = this.activeDraft();
    try {
      const r = await this.host.chat.send(message, { mode: this.mode, provider: this.provider.value, model: this.model.value, budget: this.budget(), ...(pictures ? { images: pictures } : {}), ...(d ? { activeDraftId: d.id } : {}), ...(allowDemo ? { allowDemo: true } : {}) });
      if (r.status === 'no_key' || r.status === 'error' || r.status === 'busy') { this.say('system', r.message ?? 'Something went wrong.'); this.setStage(null); }
      else if (pictures) {
        if (crop) { this.regionAnchor = { src: `data:${crop.mime};base64,${crop.base64}`, label: 'Your marked area (original)' }; this.regionPanel.resetRegion(); }
        if (this.reference) { this.reference = null; this.referenceSent = true; this.drawRef(); }
        this.drawStage();
      }
      if (r.finalOutput) this.lastExplanation = r.finalOutput;
    } catch (e) { this.say('system', 'Something went wrong: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200)); this.setStage(null); }
    this.setRunning(false);
    this.drawExplain(); this.drawActions(); this.persist();
  }

  private onEvent(e: Record<string, any>): void {
    switch (e.type) {
      case 'note': this.say('system', String(e.text)); break;
      case 'text': this.say('ai', String(e.text)); this.setStage('review'); break;
      case 'tool_call': {
        const name = String(e.name);
        if (/render_preview|compare_renders/.test(name)) this.setStage('render');
        else if (EDIT_TOOLS.test(name)) this.setStage('edit');
        else if (this.currentStage === null || this.currentStage === 'understand') this.setStage('understand');
        this.say('tool', `→ ${name}${summarize(e.args)}`); this.status.textContent = `Working… ${e.budget?.toolCalls ?? ''} calls`;
        break;
      }
      case 'tool_result': if (/"ok":\s*false|^Verktygsfel/.test(JSON.stringify(e.output ?? ''))) this.say('tool', `   ${e.name} was rejected – the AI tries to correct it.`); this.drawExplain(); break;
      case 'image': {
        const src = `data:${String(e.mime).replace(/[^a-z/+.-]/g, '')};base64,${String(e.base64).replace(/[^A-Za-z0-9+/=]/g, '')}`;
        this.previews.push({ src, label: `Preview ${this.previews.length + 1} (${e.tool === 'noema_compare_renders' ? 'comparison A | B' : 'draft'})` });
        if (this.previews.length > 12) this.previews.shift();
        this.drawStage(); this.setStage('review'); break;
      }
      case 'budget': {
        const reason: Record<string, string> = { toolCalls: 'tool calls', seconds: 'time', costUSD: 'cost', tokens: 'tokens' };
        const stopped = typeof e.status === 'string' && e.status.startsWith('budget:') ? ` The budget for ${reason[e.status.slice(7)] ?? 'the run'} ran out, so the AI finished.` : '';
        const cost = this.currentProvider()?.costKnown ? `, ca ${Number(e.costUSD).toFixed(3)} USD` : '';
        this.status.textContent = `${e.toolCalls} calls, ${e.previews} pictures, ${e.seconds} s, ${Math.round(e.tokens / 1000)} k tokens${cost}.${stopped}`;
        if (stopped) this.say('system', stopped.trim());
        this.setStage('review', true);
        break;
      }
      case 'error': this.say('system', String(e.message)); break;
      default: break;
    }
  }
}

function short(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s === undefined ? '–' : s.length > 40 ? s.slice(0, 40) + '…' : s;
}
function summarize(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const s = JSON.stringify(args);
  return s.length > 2 ? ' ' + (s.length > 90 ? s.slice(0, 90) + '…' : s) : '';
}
