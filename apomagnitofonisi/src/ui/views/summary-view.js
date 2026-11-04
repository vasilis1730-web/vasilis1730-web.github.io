/**
 * Προβολή «Περίληψη και πρακτικά»: είδος, μοντέλο, εκτίμηση κόστους, σύνταξη
 * με ροή κειμένου (Claude), διακοπή, και οι αποθηκευμένες περιλήψεις με
 * εξαγωγή, αντιγραφή και διαγραφή.
 *
 * Η φόρμα, η γραμμή κατάστασης και το κείμενο που γράφεται φτιάχνονται μία
 * φορά και ενημερώνονται επί τόπου (OO-001): η ένδειξη «ξαναγράφεται από
 * εφεδρικό μοντέλο» φαίνεται όσο γράφεται και μένει και μετά το τέλος.
 */
import { h, replaceContent, field } from '../dom.js';
import { STRINGS, errorMessage, exportFormatLabel } from '../strings.js';
import { runAction, describeError } from '../feedback.js';
import { formatDateTime, formatUsd } from '../formatters.js';
import { displayTitle } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';
import { renderMarkdown } from '../components/markdown-view.js';
import { confirmAction } from '../components/confirm-dialog.js';
import { SUMMARY_KINDS } from '../../domain/transcript.js';
import { KEY_PROVIDERS } from '../../application/api-key-service.js';
import { CLAUDE_MODELS, findClaudeModel } from '../../config/models.js';

export class SummaryView {
  title = STRINGS.summary.title;

  #deps;
  #id;
  #transcript = null;
  #root = null;
  #kind = SUMMARY_KINDS.MINUTES;
  #customInstruction = '';
  #controller = null;
  #streamed = '';
  #renderPending = false;
  #status = null;
  // Στοιχεία που φτιάχνονται μία φορά:
  #customField = null;
  #controls = [];
  #costNode = null;
  #actionNode = null;
  #statusNode = null;
  #output = null;
  #outputCard = null;
  #saved = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/library-service.js').LibraryService} deps.library
   * @param {import('../../application/summary-service.js').SummaryService} deps.summaries
   * @param {import('../../application/transcript-editor.js').TranscriptEditor} deps.editor
   * @param {import('../../application/export-service.js').ExportService} deps.exports
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {import('../../application/api-key-service.js').ApiKeyService} deps.apiKeys
   * @param {import('../../application/ports.js').FileDelivery} deps.fileDelivery
   * @param {import('../../application/ports.js').Clipboard} deps.clipboard
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {{ id: string }} params
   */
  constructor(deps, { id }) {
    this.#deps = deps;
    this.#id = id;
  }

  render() {
    this.#root = h('section', { class: 'view summary-view' }, h('h1', {}, STRINGS.summary.title));
    this.#deps.library.open(this.#id).then(t => { this.#transcript = t; this.#build(); }, error => {
      replaceContent(this.#root, h('h1', {}, STRINGS.transcript.notFound), h('p', {}, errorMessage(error)));
    });
    return this.#root;
  }

  dispose() {
    this.#controller?.abort();
  }

  /* ---------------------------------------------------------------- σχεδίαση */

  #build() {
    this.#saved = h('div');
    replaceContent(this.#root,
      h('h1', {}, STRINGS.summary.title),
      h('p', { class: 'meta' }, h('a', { href: hrefFor(ROUTES.transcript(this.#id)) }, `${STRINGS.summary.backToTranscript}: ${displayTitle(this.#transcript)}`)),
      this.#form(),
      this.#outputSection(),
      this.#saved);
    this.#refreshForm();
    this.#refreshSaved();
  }

  #form() {
    const { settings } = this.#deps;
    const kinds = h('fieldset', {}, h('legend', {}, STRINGS.summary.kind),
      Object.values(SUMMARY_KINDS).map(kind => {
        const radio = h('input', { type: 'radio', name: 'kind', value: kind, checked: this.#kind === kind, onchange: () => { this.#kind = kind; this.#refreshForm(); } });
        this.#controls.push(radio);
        return h('label', { class: 'choice' }, radio, h('span', {}, STRINGS.summary.kinds[kind]));
      }));
    const textarea = h('textarea', { rows: 3, value: this.#customInstruction, placeholder: STRINGS.summary.customPlaceholder });
    textarea.addEventListener('input', () => { this.#customInstruction = textarea.value; this.#refreshCost(); });
    this.#controls.push(textarea);
    this.#customField = field(STRINGS.summary.customLabel, textarea);
    const model = h('select', { onchange: () => { settings.update({ claudeModelId: model.value }); this.#refreshCost(); } },
      CLAUDE_MODELS.map(m => h('option', { value: m.id, selected: settings.current.claudeModelId === m.id }, m.label)));
    this.#controls.push(model);
    this.#costNode = h('p', { class: 'meta', 'aria-live': 'polite' });
    this.#actionNode = h('div', { class: 'actions' });
    const form = h('form', { class: 'card options' }, kinds, this.#customField, field(STRINGS.summary.model, model), this.#costNode, this.#actionNode);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.#hasKey() && !this.#controller) this.#generate();
    });
    return form;
  }

  #outputSection() {
    this.#statusNode = h('p', { hidden: true });
    this.#output = h('div', { class: 'markdown', 'aria-live': 'polite', 'aria-busy': 'false' });
    this.#outputCard = h('section', { class: 'card summary-output empty' }, this.#statusNode, this.#output);
    return this.#outputCard;
  }

  /** Κατάσταση της φόρμας: πεδίο οδηγίας, απενεργοποίηση όσο γράφεται, κουμπί, κόστος. */
  #refreshForm() {
    const running = Boolean(this.#controller);
    this.#customField.hidden = this.#kind !== SUMMARY_KINDS.CUSTOM;
    for (const control of this.#controls) control.disabled = running;
    const hasKey = this.#hasKey();
    replaceContent(this.#actionNode,
      !hasKey ? h('p', { class: 'warning' }, STRINGS.summary.noKey, ' ', h('a', { href: hrefFor(ROUTES.settings()) }, STRINGS.home.goToSettings)) : null,
      running
        ? h('button', { type: 'button', class: 'danger', onclick: () => this.#controller?.abort() }, STRINGS.summary.stop)
        : h('button', { type: 'submit', class: 'primary', disabled: !hasKey }, STRINGS.summary.generate));
    this.#refreshCost();
  }

  #refreshCost() {
    const modelId = this.#deps.settings.current.claudeModelId;
    const estimate = this.#deps.summaries.estimateCost(this.#transcript, { kind: this.#kind, customInstruction: this.#customInstruction, modelId });
    const model = findClaudeModel(modelId);
    this.#costNode.textContent = `${STRINGS.summary.cost}: ${STRINGS.common.approximately} ${formatUsd(estimate.usd)} (${model ? model.label : modelId}). ${STRINGS.summary.costNote}`;
  }

  /** Η γραμμή κατάστασης και το κείμενο που γράφεται (μία φορά ανά καρέ όσο έρχεται κείμενο). */
  #refreshOutput() {
    this.#statusNode.hidden = !this.#status;
    if (this.#status) {
      this.#statusNode.className = this.#status.tone;
      this.#statusNode.textContent = this.#status.text;
    }
    this.#output.setAttribute('aria-busy', this.#controller ? 'true' : 'false');
    this.#output.replaceChildren(renderMarkdown(this.#streamed));
    this.#outputCard.classList.toggle('empty', !this.#streamed && !this.#status);
  }

  #scheduleRender() {
    if (this.#renderPending) return;
    this.#renderPending = true;
    requestAnimationFrame(() => {
      this.#renderPending = false;
      if (this.#root && this.#root.isConnected) this.#refreshOutput();
    });
  }

  #refreshSaved() {
    const t = this.#transcript;
    if (!t.summaries.length) { replaceContent(this.#saved, h('p', { class: 'hint' }, STRINGS.summary.none)); return; }
    replaceContent(this.#saved, h('section', { class: 'saved-summaries', 'aria-labelledby': 'saved-title' },
      h('h2', { id: 'saved-title' }, STRINGS.summary.saved),
      t.summaries.map(summary => h('details', { class: 'card saved-summary' },
        h('summary', {}, `${STRINGS.summary.kinds[summary.kind]}, ${formatDateTime(summary.createdAt)}`),
        h('div', { class: 'markdown' }, renderMarkdown(summary.text)),
        summary.truncated ? h('p', { class: 'warning' }, STRINGS.summary.truncated) : null,
        h('p', { class: 'hint' }, STRINGS.summary.notice),
        h('div', { class: 'actions' },
          this.#deps.exports.summaryFormats.map(format => h('button', { type: 'button', class: 'secondary', onclick: () => this.#download(summary, format) }, exportFormatLabel(format))),
          h('button', { type: 'button', class: 'secondary', onclick: () => this.#copy(summary.text) }, STRINGS.common.copy),
          h('button', { type: 'button', class: 'danger', onclick: () => this.#remove(summary.id) }, STRINGS.common.delete))))));
  }

  /* ---------------------------------------------------------------- ενέργειες */

  #hasKey() {
    return this.#deps.apiKeys.hasKey(KEY_PROVIDERS.ANTHROPIC);
  }

  async #generate() {
    this.#controller = new AbortController();
    this.#streamed = '';
    this.#status = { tone: 'hint', text: STRINGS.summary.writing };
    this.#refreshForm();
    this.#refreshOutput();
    try {
      const outcome = await this.#deps.summaries.summarize(this.#transcript, {
        kind: this.#kind,
        customInstruction: this.#customInstruction,
        modelId: this.#deps.settings.current.claudeModelId,
        signal: this.#controller.signal,
        onText: delta => { this.#streamed += delta; this.#scheduleRender(); },
        onRestart: () => { this.#streamed = ''; this.#status = { tone: 'warning', text: STRINGS.summary.restarted }; this.#scheduleRender(); },
      });
      this.#transcript = outcome.transcript;
      this.#streamed = outcome.summary.text;
      this.#status = finalStatus(outcome);
      this.#refreshSaved();
    } catch (error) {
      this.#status = { tone: 'error', text: describeError(error) };
    } finally {
      this.#controller = null;
      if (this.#root && this.#root.isConnected) {
        this.#refreshForm();
        this.#refreshOutput();
      }
    }
  }

  #download(summary, format) {
    return runAction(this.#deps.toasts, () => this.#deps.fileDelivery.download(this.#deps.exports.exportSummary(this.#transcript, summary, format)));
  }

  #copy(text) {
    return runAction(this.#deps.toasts, () => this.#deps.clipboard.copyText(text), { success: STRINGS.common.copied });
  }

  async #remove(summaryId) {
    if (!(await confirmAction({ message: STRINGS.summary.deleteConfirm, confirmLabel: STRINGS.common.delete, danger: true }))) return;
    const updated = await runAction(this.#deps.toasts, () => this.#deps.editor.removeSummary(this.#transcript, summaryId));
    if (!updated) return;
    this.#transcript = updated;
    this.#refreshSaved();
  }
}

/** Η ένδειξη μετά το τέλος: κομμένο κείμενο ή εφεδρικό μοντέλο, αλλιώς τίποτα. */
function finalStatus({ summary, restarted }) {
  const notes = [];
  if (restarted) notes.push(STRINGS.summary.restartedDone);
  if (summary.truncated) notes.push(STRINGS.summary.truncated);
  return notes.length ? { tone: 'warning', text: notes.join(' ') } : null;
}
