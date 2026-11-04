/**
 * Προβολή «Περίληψη και πρακτικά»: η φόρμα του αιτήματος (είδος, οδηγία,
 * μοντέλο, εκτίμηση κόστους), η σύνταξη με ροή κειμένου και η διακοπή της.
 * Οι αποθηκευμένες περιλήψεις είναι δικό τους μέρος (SavedSummariesList, OO-015).
 *
 * Το αν μπορεί να γραφτεί περίληψη (π.χ. αν υπάρχει κλειδί) το λέει η
 * υπηρεσία περιλήψεων (checkAvailability): η προβολή δεν ξέρει πάροχο ή κλειδί.
 *
 * Η επικεφαλίδα, η φόρμα, η γραμμή κατάστασης και το κείμενο που γράφεται
 * φτιάχνονται μία φορά και ενημερώνονται επί τόπου (OO-001): η ένδειξη
 * «ξαναγράφεται από εφεδρικό μοντέλο» φαίνεται όσο γράφεται και μένει και μετά
 * το τέλος. Το κουμπί «Σύνταξη» γίνεται «Διακοπή» χωρίς να αντικατασταθεί.
 */
import { h, field } from '../dom.js';
import { STRINGS, errorMessage, messageForCode } from '../strings.js';
import { describeError, reportUnexpected } from '../feedback.js';
import { formatUsd } from '../formatters.js';
import { displayTitle } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';
import { renderMarkdown } from '../components/markdown-view.js';
import { SavedSummariesList } from '../components/saved-summaries-list.js';
import { SUMMARY_KINDS } from '../../domain/transcript.js';
import { ERROR_CODES, isCancellation } from '../../application/errors.js';
import { CLAUDE_MODELS, findClaudeModel } from '../../config/models.js';

export class SummaryView {
  title = STRINGS.summary.title;

  #deps;
  #id;
  #transcript = null;
  #availability = null;
  #kind = SUMMARY_KINDS.MINUTES;
  #customInstruction = '';
  #controller = null;
  #streamed = '';
  #renderPending = false;
  #status = null;
  #saved;
  // Στοιχεία που φτιάχνονται μία φορά:
  #root = null;
  #heading = null;
  #customField = null;
  #controls = [];
  #costNode = null;
  #notice = null;
  #actionButton = null;
  #statusNode = null;
  #output = null;
  #outputCard = null;

  /**
   * @param {Object} deps
   * @param {Pick<import('../../application/library-service.js').LibraryService, 'open'>} deps.library
   * @param {Pick<import('../../application/summary-service.js').SummaryService, 'checkAvailability'|'estimateCost'|'summarize'>} deps.summaries
   * @param {import('../../application/settings-service.js').SettingsService} deps.settings
   * @param {Pick<import('../../application/transcript-editor.js').TranscriptEditor, 'removeSummary'>} deps.editor
   * @param {Pick<import('../../application/export-service.js').ExportService, 'summaryFormats'|'exportSummary'>} deps.exports
   * @param {import('../../application/ports.js').FileDelivery} deps.fileDelivery
   * @param {import('../../application/ports.js').Clipboard} deps.clipboard
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {{ id: string }} params
   */
  constructor(deps, { id }) {
    this.#deps = deps;
    this.#id = id;
    this.#saved = new SavedSummariesList({
      editor: deps.editor,
      exports: deps.exports,
      fileDelivery: deps.fileDelivery,
      clipboard: deps.clipboard,
      toasts: deps.toasts,
      onChange: transcript => { this.#transcript = transcript; },
    });
  }

  render() {
    this.#heading = h('h1', {}, STRINGS.summary.title);
    this.#root = h('section', { class: 'view summary-view' }, this.#heading);
    this.#deps.library.open(this.#id).then(transcript => this.#build(transcript), error => {
      this.#heading.textContent = STRINGS.transcript.notFound;
      this.#root.append(h('p', {}, errorMessage(error)));
    });
    this.#deps.summaries.checkAvailability().then(availability => this.#setAvailability(availability), error => {
      reportUnexpected(error);
      this.#setAvailability({ available: false, reason: ERROR_CODES.UNKNOWN });
    });
    return this.#root;
  }

  dispose() {
    this.#controller?.abort();
  }

  /* ---------------------------------------------------------------- σχεδίαση */

  #build(transcript) {
    this.#transcript = transcript;
    this.#root.append(
      h('p', { class: 'meta' }, h('a', { href: hrefFor(ROUTES.transcript(this.#id)) }, `${STRINGS.summary.backToTranscript}: ${displayTitle(transcript)}`)),
      this.#form(),
      this.#outputSection(),
      this.#saved.element());
    this.#saved.setTranscript(transcript);
    this.#refreshForm();
  }

  #setAvailability(availability) {
    this.#availability = availability;
    if (this.#transcript) this.#refreshForm();
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
    this.#notice = h('p', { class: 'warning', hidden: true });
    // Ένα κουμπί για «Σύνταξη» και «Διακοπή»: όσο γράφεται, το κλικ σταματά τη σύνταξη.
    this.#actionButton = h('button', { type: 'submit', class: 'primary', disabled: true, onclick: event => {
      if (!this.#controller) return;
      event.preventDefault();
      this.#controller.abort();
    } }, STRINGS.summary.generate);
    const form = h('form', { class: 'card options' }, kinds, this.#customField, field(STRINGS.summary.model, model), this.#costNode,
      h('div', { class: 'actions' }, this.#notice, this.#actionButton));
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.#canGenerate()) this.#generate();
    });
    return form;
  }

  #outputSection() {
    this.#statusNode = h('p', { hidden: true });
    this.#output = h('div', { class: 'markdown', 'aria-live': 'polite', 'aria-busy': 'false' });
    this.#outputCard = h('section', { class: 'card summary-output empty' }, this.#statusNode, this.#output);
    return this.#outputCard;
  }

  #canGenerate() {
    return Boolean(this.#transcript && this.#availability && this.#availability.available && !this.#controller);
  }

  /** Κατάσταση της φόρμας: πεδίο οδηγίας, απενεργοποίηση όσο γράφεται, ειδοποίηση, κουμπί, κόστος. */
  #refreshForm() {
    const running = Boolean(this.#controller);
    this.#customField.hidden = this.#kind !== SUMMARY_KINDS.CUSTOM;
    for (const control of this.#controls) control.disabled = running;
    this.#saved.setBusy(running);
    this.#refreshNotice();
    this.#actionButton.className = running ? 'danger' : 'primary';
    this.#actionButton.textContent = running ? STRINGS.summary.stop : STRINGS.summary.generate;
    this.#actionButton.disabled = !running && !this.#canGenerate();
    this.#refreshCost();
  }

  /** Γιατί δεν γράφεται περίληψη (π.χ. λείπει κλειδί), με σύνδεσμο στις Ρυθμίσεις όπου βοηθά. */
  #refreshNotice() {
    const availability = this.#availability;
    const blocked = Boolean(availability && !availability.available);
    this.#notice.hidden = !blocked;
    if (!blocked) return;
    const missingKey = availability.reason === ERROR_CODES.KEY_MISSING;
    this.#notice.replaceChildren(
      missingKey ? STRINGS.summary.noKey : messageForCode(availability.reason),
      ...(missingKey ? [' ', h('a', { href: hrefFor(ROUTES.settings()) }, STRINGS.home.goToSettings)] : []));
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

  /* ---------------------------------------------------------------- σύνταξη */

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
      this.#saved.setTranscript(outcome.transcript);
    } catch (error) {
      // Η «Διακοπή» του χρήστη δεν είναι σφάλμα (OO-007).
      if (isCancellation(error)) {
        this.#status = { tone: 'hint', text: STRINGS.summary.stopped };
      } else {
        reportUnexpected(error);
        this.#status = { tone: 'error', text: describeError(error) };
      }
    } finally {
      this.#controller = null;
      if (this.#root && this.#root.isConnected) {
        this.#refreshForm();
        this.#refreshOutput();
      }
    }
  }
}

/** Η ένδειξη μετά το τέλος: κομμένο κείμενο ή εφεδρικό μοντέλο, αλλιώς τίποτα. */
function finalStatus({ summary, restarted }) {
  const notes = [];
  if (restarted) notes.push(STRINGS.summary.restartedDone);
  if (summary.truncated) notes.push(STRINGS.summary.truncated);
  return notes.length ? { tone: 'warning', text: notes.join(' ') } : null;
}
