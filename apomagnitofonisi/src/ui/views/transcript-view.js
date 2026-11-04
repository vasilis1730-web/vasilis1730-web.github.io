/**
 * Προβολή μιας μεταγραφής. Συνθέτει τα μέρη της σελίδας, που το καθένα κρατά
 * το δικό του DOM και ενημερώνεται επί τόπου (OO-001):
 * - ExportToolbar: περίληψη, εξαγωγή, αντιγραφή, κοινή χρήση,
 * - MediaPlayer: αναπαραγωγή (φτιάχνεται μία φορά, δεν σταματά στις διορθώσεις),
 * - SpeakersPanel: ονόματα, χρώματα, χρόνος ομιλίας,
 * - SegmentList: τμήματα, διόρθωση κειμένου, αναζήτηση, τρέχον τμήμα.
 * Η προβολή εφαρμόζει κάθε διόρθωση μέσω του TranscriptEditor και ενημερώνει
 * μόνο τα μέρη που αφορά.
 */
import { h, replaceContent, field } from '../dom.js';
import { STRINGS, errorMessage } from '../strings.js';
import { runAction } from '../feedback.js';
import { formatDateTime, formatDuration } from '../formatters.js';
import { describeEngine, displayTitle } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';
import { transcriptDuration } from '../../domain/transcript.js';
import { promptText, pickSpeaker, NEW_SPEAKER } from '../components/confirm-dialog.js';
import { ExportToolbar } from '../components/export-toolbar.js';
import { MediaPlayer } from '../components/media-player.js';
import { SpeakersPanel } from '../components/speakers-panel.js';
import { SegmentList } from '../components/segment-list.js';

export class TranscriptView {
  title = STRINGS.appName;

  #deps;
  #id;
  #context = null;
  #transcript = null;
  #root = null;
  #heading = null;
  #titleInput = null;
  #toolbar;
  #player;
  #speakers;
  #segments;

  /**
   * @param {Object} deps
   * @param {import('../../application/library-service.js').LibraryService} deps.library
   * @param {import('../../application/transcript-editor.js').TranscriptEditor} deps.editor
   * @param {import('../../application/export-service.js').ExportService} deps.exports
   * @param {import('../../application/ports.js').FileDelivery} deps.fileDelivery
   * @param {import('../../application/ports.js').Clipboard} deps.clipboard
   * @param {import('../session-media.js').SessionMedia} deps.sessionMedia
   * @param {import('../components/toast.js').ToastHost} deps.toasts
   * @param {{ id: string }} params
   */
  constructor(deps, { id }) {
    this.#deps = deps;
    this.#id = id;
    this.#toolbar = new ExportToolbar({ exports: deps.exports, fileDelivery: deps.fileDelivery, clipboard: deps.clipboard, toasts: deps.toasts });
    this.#player = new MediaPlayer({ sessionMedia: deps.sessionMedia, transcriptId: id, onTime: seconds => this.#segments.highlightAt(seconds, { follow: this.#player.isPlaying }) });
    this.#speakers = new SpeakersPanel({ onRename: (speakerId, label) => this.#renameSpeaker(speakerId, label), onAdd: () => this.#addSpeaker() });
    this.#segments = new SegmentList({
      onSeek: seconds => this.#player.playFrom(seconds),
      onEditText: (segmentId, text) => this.#editText(segmentId, text),
      onChooseSpeaker: segmentId => this.#chooseSpeaker(segmentId),
    });
  }

  /** @param {import('../app-shell.js').ViewContext} context */
  render(context) {
    this.#context = context;
    this.#root = h('section', { class: 'view transcript-view' }, h('h1', {}, STRINGS.common.loading));
    this.#deps.library.open(this.#id).then(transcript => this.#show(transcript), error => {
      replaceContent(this.#root, h('h1', {}, STRINGS.transcript.notFound), h('p', {}, errorMessage(error)), h('a', { href: hrefFor(ROUTES.history()) }, STRINGS.nav.history));
    });
    return this.#root;
  }

  dispose() {
    this.#player.dispose();
  }

  /* ---------------------------------------------------------------- σχεδίαση */

  #show(transcript) {
    this.#transcript = transcript;
    this.#heading = h('h1', {});
    this.#titleInput = h('input', { type: 'text', maxLength: 200, autocomplete: 'off' });
    this.#titleInput.addEventListener('change', () => this.#setTitle(this.#titleInput.value));
    replaceContent(this.#root,
      this.#heading,
      h('p', { class: 'meta' }, formatDateTime(transcript.createdAt), `, ${formatDuration(transcriptDuration(transcript))}, ${describeEngine(transcript.engine)}`),
      this.#toolbar.element(),
      field(STRINGS.transcript.titleLabel, this.#titleInput),
      this.#player.element(),
      this.#speakers.element(),
      transcript.segments.length ? this.#segments.element() : h('p', { class: 'notice' }, STRINGS.transcript.empty));
    this.#segments.setTranscript(transcript);
    this.#refreshTitle();
    this.#speakers.update(transcript);
  }

  #refreshTitle() {
    const title = displayTitle(this.#transcript);
    this.#heading.textContent = title;
    if (document.activeElement !== this.#titleInput) this.#titleInput.value = this.#transcript.title;
    this.title = title;
    this.#context?.refreshTitle();
    this.#toolbar.setTranscript(this.#transcript);
  }

  /* ---------------------------------------------------------------- διορθώσεις */

  /** Εφαρμόζει μια διόρθωση. Επιστρέφει true όταν αποθηκεύτηκε. */
  async #apply(change) {
    const updated = await runAction(this.#deps.toasts, () => change(this.#transcript));
    if (!updated) return false;
    this.#transcript = updated;
    this.#toolbar.setTranscript(updated);
    return true;
  }

  async #setTitle(title) {
    await this.#apply(t => this.#deps.editor.setTitle(t, title));
    this.#titleInput.value = this.#transcript.title;
    this.#refreshTitle();
  }

  async #renameSpeaker(speakerId, label) {
    if (await this.#apply(t => this.#deps.editor.renameSpeaker(t, speakerId, label))) {
      this.#speakers.update(this.#transcript);
      this.#segments.updateSpeakers(this.#transcript);
    } else {
      this.#speakers.restore(speakerId);
    }
  }

  async #editText(segmentId, text) {
    await this.#apply(t => this.#deps.editor.editSegmentText(t, segmentId, text));
    this.#segments.updateSegment(this.#transcript, segmentId);
  }

  async #chooseSpeaker(segmentId) {
    const segment = this.#transcript.segments.find(s => s.id === segmentId);
    if (!segment) return;
    const options = [...this.#transcript.speakers.map(s => ({ id: s.id, label: s.label })), { id: null, label: STRINGS.transcript.noSpeaker }];
    const chosen = await pickSpeaker({ options, currentId: segment.speakerId });
    if (chosen === undefined) return;
    if (chosen === NEW_SPEAKER) { await this.#addSpeaker(segmentId); return; }
    if (await this.#apply(t => this.#deps.editor.assignSpeaker(t, segmentId, chosen))) {
      this.#segments.updateSegment(this.#transcript, segmentId);
      this.#speakers.update(this.#transcript);
    }
  }

  async #addSpeaker(segmentId = null) {
    const name = await promptText({ label: STRINGS.transcript.newSpeakerName });
    if (!name) return;
    const added = await this.#apply(async t => {
      const { transcript, speakerId } = await this.#deps.editor.addSpeaker(t, name);
      return segmentId ? this.#deps.editor.assignSpeaker(transcript, segmentId, speakerId) : transcript;
    });
    if (!added) return;
    this.#speakers.update(this.#transcript);
    if (segmentId) this.#segments.updateSegment(this.#transcript, segmentId);
  }
}
