/**
 * Προβολή «Περίληψη και πρακτικά»: είδος, μοντέλο, εκτίμηση κόστους, σύνταξη
 * με ροή κειμένου (Claude), διακοπή, και οι αποθηκευμένες περιλήψεις με
 * εξαγωγή σε Word ή κείμενο, αντιγραφή και διαγραφή.
 */
import { h, clear, field } from '../dom.js';
import { STRINGS, errorMessage, providerMessage } from '../strings.js';
import { formatDateTime, formatUsd } from '../formatters.js';
import { renderMarkdown } from '../components/markdown-view.js';
import { confirmAction } from '../components/confirm-dialog.js';
import { SUMMARY_KINDS } from '../../domain/transcript.js';
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
  #output = null;
  #renderPending = false;
  #status = null;

  /**
   * @param {Object} deps
   * @param {import('../../application/library-service.js').LibraryService} deps.library
   * @param {import('../../application/summary-service.js').SummaryService} deps.summaries
   * @param {import('../../application/transcript-editor.js').TranscriptEditor} deps.editor
   * @param {import('../../application/export-service.js').ExportService} deps.exports
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {import('../../application/api-key-service.js').ApiKeyService} deps.apiKeys
   * @param {import('../../infrastructure/platform/file-saver.js').BrowserFileSaver} deps.fileSaver
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {Document} deps.document
   * @param {string} transcriptId
   */
  constructor(deps, transcriptId) {
    this.#deps = deps;
    this.#id = transcriptId;
  }

  render() {
    this.#root = h('section', { class: 'view summary-view' }, h('h1', {}, STRINGS.summary.title));
    this.#deps.library.open(this.#id).then(t => { this.#transcript = t; this.#draw(); }, error => {
      clear(this.#root).append(h('h1', {}, STRINGS.transcript.notFound), h('p', {}, errorMessage(error)));
    });
    return this.#root;
  }

  dispose() {
    this.#controller?.abort();
  }

  #draw() {
    const t = this.#transcript;
    clear(this.#root).append(
      h('h1', {}, STRINGS.summary.title),
      h('p', { class: 'meta' }, h('a', { href: `#/t/${encodeURIComponent(this.#id)}` }, `${STRINGS.summary.backToTranscript}: ${t.title}`)),
      this.#form(),
      this.#outputCard(),
      this.#savedList(),
    );
  }

  #form() {
    const { settings, apiKeys } = this.#deps;
    const running = Boolean(this.#controller);
    const hasKey = apiKeys.hasKey('anthropic');
    const form = h('form', { class: 'card options' });

    form.append(h('fieldset', {}, h('legend', {}, STRINGS.summary.kind),
      Object.values(SUMMARY_KINDS).map(kind => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'kind', value: kind, checked: this.#kind === kind, disabled: running, onchange: () => { this.#kind = kind; this.#draw(); } }),
        h('span', {}, STRINGS.summary.kinds[kind])))));

    if (this.#kind === SUMMARY_KINDS.CUSTOM) {
      const textarea = h('textarea', { rows: 3, value: this.#customInstruction, placeholder: STRINGS.summary.customPlaceholder, disabled: running });
      textarea.addEventListener('input', () => { this.#customInstruction = textarea.value; this.#updateCost(costNode); });
      form.append(field(STRINGS.summary.customLabel, textarea));
    }

    const model = h('select', { disabled: running, onchange: () => { settings.update({ claudeModelId: model.value }); this.#updateCost(costNode); } },
      CLAUDE_MODELS.map(m => h('option', { value: m.id, selected: settings.current.claudeModelId === m.id }, m.label)));
    form.append(field(STRINGS.summary.model, model));

    const costNode = h('p', { class: 'meta', 'aria-live': 'polite' });
    this.#updateCost(costNode);
    form.append(costNode);

    if (!hasKey) form.append(h('p', { class: 'warning' }, STRINGS.summary.noKey, ' ', h('a', { href: '#/settings' }, STRINGS.home.goToSettings)));
    form.append(h('div', { class: 'actions' },
      running
        ? h('button', { type: 'button', class: 'danger', onclick: () => this.#controller?.abort() }, STRINGS.summary.stop)
        : h('button', { type: 'submit', class: 'primary', disabled: !hasKey }, STRINGS.summary.generate)));
    form.addEventListener('submit', event => { event.preventDefault(); if (hasKey && !running) this.#generate(); });
    return form;
  }

  #updateCost(node) {
    const modelId = this.#deps.settings.current.claudeModelId;
    const estimate = this.#deps.summaries.estimateCost(this.#transcript, { kind: this.#kind, customInstruction: this.#customInstruction, modelId });
    const model = findClaudeModel(modelId);
    node.textContent = `${STRINGS.summary.cost}: ${STRINGS.common.approximately} ${formatUsd(estimate.usd)} (${model ? model.label : modelId}). ${STRINGS.summary.costNote}`;
  }

  #outputCard() {
    this.#output = h('div', { class: 'markdown', 'aria-live': 'polite', 'aria-busy': this.#controller ? 'true' : 'false' });
    if (this.#streamed) this.#output.append(renderMarkdown(this.#streamed));
    return h('section', { class: ['card', 'summary-output', this.#streamed || this.#status ? '' : 'empty'] },
      this.#status ? h('p', { class: this.#status.tone }, this.#status.text) : null,
      this.#output);
  }

  #savedList() {
    const t = this.#transcript;
    if (!t.summaries.length) return h('p', { class: 'hint' }, STRINGS.summary.none);
    return h('section', { class: 'saved-summaries', 'aria-labelledby': 'saved-title' },
      h('h2', { id: 'saved-title' }, STRINGS.summary.saved),
      t.summaries.map(summary => h('details', { class: 'card saved-summary' },
        h('summary', {}, `${STRINGS.summary.kinds[summary.kind]}, ${formatDateTime(summary.createdAt)}`),
        h('div', { class: 'markdown' }, renderMarkdown(summary.text)),
        summary.truncated ? h('p', { class: 'warning' }, STRINGS.summary.truncated) : null,
        h('p', { class: 'hint' }, STRINGS.summary.notice),
        h('div', { class: 'actions' },
          this.#deps.exports.summaryFormats.map(format => h('button', { type: 'button', class: 'secondary', onclick: () => this.#download(summary.id, format) },
            format === 'docx' ? STRINGS.transcript.exportDocx : STRINGS.transcript.exportTxt)),
          h('button', { type: 'button', class: 'secondary', onclick: () => this.#copy(summary.text) }, STRINGS.common.copy),
          h('button', { type: 'button', class: 'danger', onclick: () => this.#remove(summary.id) }, STRINGS.common.delete)))));
  }

  async #generate() {
    this.#controller = new AbortController();
    this.#streamed = '';
    this.#status = { tone: 'hint', text: STRINGS.summary.writing };
    this.#draw();
    try {
      const { transcript, summary } = await this.#deps.summaries.summarize(this.#transcript, {
        kind: this.#kind,
        customInstruction: this.#customInstruction,
        modelId: this.#deps.settings.current.claudeModelId,
        signal: this.#controller.signal,
        onText: delta => { this.#streamed += delta; this.#scheduleRender(); },
        onRestart: () => { this.#streamed = ''; this.#status = { tone: 'warning', text: STRINGS.summary.restarted }; this.#scheduleRender(); },
      });
      this.#transcript = transcript;
      this.#streamed = summary.text;
      this.#status = summary.truncated ? { tone: 'warning', text: STRINGS.summary.truncated } : null;
    } catch (error) {
      const fromProvider = providerMessage(error);
      this.#status = { tone: 'error', text: fromProvider ? `${errorMessage(error)} ${STRINGS.errors.providerSaid}: ${fromProvider}` : errorMessage(error) };
    } finally {
      this.#controller = null;
      if (this.#root && this.#root.isConnected) this.#draw();
    }
  }

  /** Μία σχεδίαση ανά καρέ όσο έρχεται κείμενο (όχι σε κάθε token). */
  #scheduleRender() {
    if (this.#renderPending) return;
    this.#renderPending = true;
    requestAnimationFrame(() => {
      this.#renderPending = false;
      if (!this.#output || !this.#output.isConnected) return;
      this.#output.replaceChildren(renderMarkdown(this.#streamed));
    });
  }

  #download(summaryId, format) {
    try {
      this.#deps.fileSaver.download(this.#deps.exports.exportSummary(this.#transcript, summaryId, format));
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  async #copy(text) {
    try {
      await this.#deps.fileSaver.copyText(text);
      this.#deps.toasts.show(STRINGS.common.copied, { tone: 'success' });
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }

  async #remove(summaryId) {
    if (!(await confirmAction(this.#deps.document, { message: STRINGS.summary.deleteConfirm, confirmLabel: STRINGS.common.delete, danger: true }))) return;
    try {
      this.#transcript = await this.#deps.editor.removeSummary(this.#transcript, summaryId);
      this.#draw();
    } catch (error) {
      this.#deps.toasts.show(errorMessage(error), { tone: 'error' });
    }
  }
}
