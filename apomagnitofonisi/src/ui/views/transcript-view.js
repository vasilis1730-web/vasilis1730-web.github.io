/**
 * Προβολή μιας μεταγραφής. Συνθέτει τα μέρη της σελίδας, που το καθένα κρατά
 * το δικό του DOM και ενημερώνεται επί τόπου (OO-001):
 * - ExportToolbar: περίληψη, εξαγωγή, αντιγραφή, κοινή χρήση,
 * - MediaPlayer: αναπαραγωγή (φτιάχνεται μία φορά, δεν σταματά στις διορθώσεις),
 * - SpeakersPanel: ονόματα, χρώματα, χρόνος ομιλίας,
 * - SegmentList: τμήματα, διόρθωση κειμένου, αναζήτηση, τρέχον τμήμα.
 *
 * Κάθε διόρθωση γίνεται με ΜΙΑ κλήση του TranscriptEditor (μία αποθήκευση) και
 * η νέα έκδοση περνά από το #commit, που τη δίνει σε όλα τα μέρη (OO-016).
 * Κάθε μέρος τη συγκρίνει με την προηγούμενη και αλλάζει μόνο ό,τι άλλαξε,
 * άρα μια νέα διόρθωση δεν χρειάζεται να ξέρει ποια μέρη αφορά.
 */
import { h, field } from '../dom.js';
import { STRINGS } from '../strings.js';
import { openFailureHeading, presentError, runAction } from '../feedback.js';
import { formatDateTime, formatDuration } from '../formatters.js';
import { describeEngine, displayTitle } from '../presentation.js';
import { ROUTES, hrefFor } from '../routes.js';
import { transcriptDuration, MAX_TITLE_LENGTH, MAX_SPEAKER_LABEL_LENGTH } from '../../domain/transcript.js';
import { promptText, pickSpeaker, SPEAKER_CHOICES } from '../components/confirm-dialog.js';
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
   * @param {Pick<import('../../application/library-service.js').LibraryService, 'open'>} deps.library
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
    // Η επικεφαλίδα μένει η ίδια όταν έρθει η μεταγραφή: αλλάζει μόνο το κείμενό της,
    // άρα η εστίαση που της δίνει το AppShell δεν χάνεται (OO-001).
    this.#heading = h('h1', {}, STRINGS.common.loading);
    this.#root = h('section', { class: 'view transcript-view' }, this.#heading);
    // API-025: και ένα σφάλμα μέσα στο #show φτάνει στο ίδιο μήνυμα (όχι «Φόρτωση…» για πάντα).
    this.#deps.library.open(this.#id).then(transcript => this.#show(transcript)).catch(error => {
      this.#heading.textContent = openFailureHeading(error);
      this.#root.append(h('p', { class: 'error' }, presentError(error)), h('a', { href: hrefFor(ROUTES.history()) }, STRINGS.nav.history));
    });
    return this.#root;
  }

  dispose() {
    this.#player.dispose();
  }

  /* ---------------------------------------------------------------- σχεδίαση */

  #show(transcript) {
    this.#titleInput = h('input', { type: 'text', maxLength: MAX_TITLE_LENGTH, autocomplete: 'off' });
    this.#titleInput.addEventListener('change', () => this.#setTitle(this.#titleInput.value));
    this.#root.append(
      h('p', { class: 'meta' }, formatDateTime(transcript.createdAt), `, ${formatDuration(transcriptDuration(transcript))}, ${describeEngine(transcript.engine)}`),
      this.#toolbar.element(),
      field(STRINGS.transcript.titleLabel, this.#titleInput),
      this.#player.element(),
      this.#speakers.element(),
      transcript.segments.length ? this.#segments.element() : h('p', { class: 'notice' }, STRINGS.transcript.empty));
    this.#commit(transcript);
  }

  /** Η μία διαδρομή κάθε νέας έκδοσης της μεταγραφής: όλα τα μέρη, το καθένα αλλάζει μόνο ό,τι άλλαξε. */
  #commit(transcript) {
    this.#transcript = transcript;
    const title = displayTitle(transcript);
    this.#heading.textContent = title;
    if (document.activeElement !== this.#titleInput) this.#titleInput.value = transcript.title;
    if (this.title !== title) {
      this.title = title;
      this.#context?.refreshTitle();
    }
    this.#toolbar.setTranscript(transcript);
    this.#speakers.setTranscript(transcript);
    this.#segments.setTranscript(transcript);
  }

  /* ---------------------------------------------------------------- διορθώσεις */

  /** Εφαρμόζει μια διόρθωση και, αν αποθηκεύτηκε, τη δίνει σε όλα τα μέρη. Επιστρέφει αν αποθηκεύτηκε. */
  async #edit(change) {
    const outcome = await runAction(this.#deps.toasts, () => change(this.#transcript));
    if (outcome.ok) this.#commit(outcome.value);
    return outcome.ok;
  }

  async #setTitle(title) {
    await this.#edit(t => this.#deps.editor.setTitle(t, title));
    // Ο τίτλος όπως αποθηκεύτηκε (π.χ. χωρίς τα κενά στην άκρη), ή ο παλιός αν δεν αποθηκεύτηκε.
    this.#titleInput.value = this.#transcript.title;
  }

  async #renameSpeaker(speakerId, label) {
    if (!(await this.#edit(t => this.#deps.editor.renameSpeaker(t, speakerId, label)))) this.#speakers.restore(speakerId);
  }

  async #editText(segmentId, text) {
    if (!(await this.#edit(t => this.#deps.editor.editSegmentText(t, segmentId, text)))) this.#segments.restore(segmentId);
  }

  async #chooseSpeaker(segmentId) {
    const segment = this.#transcript.segments.find(s => s.id === segmentId);
    if (!segment) return;
    const options = [...this.#transcript.speakers.map(s => ({ id: s.id, label: s.label })), { id: null, label: STRINGS.transcript.noSpeaker }];
    const choice = await pickSpeaker({ options, currentId: segment.speakerId });
    if (choice.kind === SPEAKER_CHOICES.NEW) await this.#addSpeaker(segmentId);
    else if (choice.kind === SPEAKER_CHOICES.ASSIGN) await this.#edit(t => this.#deps.editor.assignSpeaker(t, segmentId, choice.speakerId));
  }

  /** Νέος ομιλητής, και αν δοθεί τμήμα, ανάθεση σε αυτό με την ίδια αποθήκευση (OO-013). */
  async #addSpeaker(segmentId = null) {
    const name = await promptText({ label: STRINGS.transcript.newSpeakerName, maxLength: MAX_SPEAKER_LABEL_LENGTH });
    if (!name) return;
    const { editor } = this.#deps;
    await this.#edit(async t => (segmentId ? await editor.addSpeakerToSegment(t, segmentId, name) : await editor.addSpeaker(t, name)).transcript);
  }
}
