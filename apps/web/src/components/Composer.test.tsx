import type { Attachment } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { Composer, type ComposerProps } from './Composer';

const at = '2026-10-19T09:00:00.000Z';

const uploaded: Attachment = {
  id: 'att_1',
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 5,
  kind: 'file',
  createdAt: at,
};

const noop = async () => undefined;
const upload = async (file: File): Promise<Attachment> => ({ ...uploaded, name: file.name, size: file.size });

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

const sendButton = (html: string): string => html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? '';

function render(overrides: Partial<ComposerProps> = {}): string {
  const props: ComposerProps = { targetName: 'Capy', uploadAttachment: upload, onSend: noop, ...overrides };
  return renderToStaticMarkup(<Composer {...props} />);
}

const notes = () => new File(['hello world'], 'notes.txt', { type: 'text/plain' });
const photo = () => new File(['1234567890'], 'photo.png', { type: 'image/png' });

describe('composer attachments', () => {
  it('offers the attach button and keeps send disabled without a message', () => {
    const html = render();

    expect(html).toContain(`aria-label="${t('composer.attach')}"`);
    expect(sendButton(html)).toContain('disabled=""');
    expect(textOf(html)).toContain(t('composer.hintAttach'));
  });

  it('shows pending files with their name and human size, and a remove action', () => {
    const html = render({ initialFiles: [notes(), photo()] });
    const text = textOf(html);

    expect(text).toContain(t('composer.pendingFiles'));
    expect(text).toContain('notes.txt');
    expect(text).toContain('11 B');
    expect(text).toContain('photo.png');
    expect(text).toContain('10 B');
    expect(html).toContain(`aria-label="${t('composer.removeFile', { name: 'notes.txt' })}"`);
    expect(html).toContain(`aria-label="${t('composer.removeFile', { name: 'photo.png' })}"`);
    expect(sendButton(html)).toContain('disabled=""');
  });

  it('flags an unsupported file before it is ever uploaded', () => {
    const html = render({ initialFiles: [new File(['x'], 'tool.exe', { type: 'application/x-msdownload' })] });

    expect(textOf(html)).toContain(t('composer.attachUnsupported', { name: 'tool.exe' }));
    expect(sendButton(html)).toContain('disabled=""');
  });

  it('disables send and says it is uploading while files upload', () => {
    const text = textOf(render({ initialUploading: true }));

    expect(text).toContain(t('composer.uploading'));
    expect(sendButton(render({ initialUploading: true }))).toContain('disabled=""');
  });

  it('hides the paperclip where a conversation cannot take attachments', () => {
    const html = render({ uploadAttachment: undefined });

    expect(html).not.toContain(`aria-label="${t('composer.attach')}"`);
    expect(textOf(html)).toContain(t('composer.hint'));
  });
});

describe('composer slash commands', () => {
  it('lists every command when /help opens the list', () => {
    const text = textOf(render({ initialHelpOpen: true }));

    expect(text).toContain(t('composer.commands.menuLabel'));
    expect(text).toContain('/help');
    expect(text).toContain('/new');
    expect(text).toContain('/rename <title>');
    expect(text).toContain('/model <provider>/<model> | default');
    expect(text).toContain('/stop');
    for (const key of ['helpDesc', 'newDesc', 'renameDesc', 'modelDesc', 'stopDesc'] as const) {
      expect(text).toContain(t(`composer.commands.${key}`));
    }
  });

  it('shows suggestions while a slash prefix is typed', () => {
    const text = textOf(render({ initialDraft: '/re' }));

    expect(text).toContain('/rename <title>');
    expect(text).toContain(t('composer.commands.renameDesc'));
  });

  it('shows an inline hint for an unknown command', () => {
    const text = textOf(render({ initialCommandHint: t('composer.commands.unknown', { command: '/wat' }) }));

    expect(text).toContain('Unknown command: /wat. Try /help.');
    expect(text).toContain('role="alert"');
  });
});

describe('composer dictation', () => {
  it('offers the mic button when dictation may be available', () => {
    const html = render();

    const mic = html.match(new RegExp(`<button[^>]*aria-label="${t('composer.dictate')}"[^>]*>`))?.[0] ?? '';
    expect(mic).not.toBe('');
    expect(mic).not.toContain('disabled=""');
  });

  it('renders a disabled mic with the reason when unsupported', () => {
    const html = render({ initialDictation: 'unsupported' });

    expect(html).toContain(`aria-label="${t('composer.dictationUnsupported')}"`);
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-label="${t('composer.dictationUnsupported')}"`));
  });

  it('shows the listening state with a stop affordance', () => {
    const html = render({ initialDictation: 'listening' });

    expect(html).toContain(`aria-label="${t('composer.dictationStop')}"`);
    expect(html).toContain('aria-pressed="true"');
  });
});

describe('composer voice notes', () => {
  it('offers the record button when attachments are available', () => {
    const html = render();
    expect(html).toContain(`aria-label="${t('composer.recordVoice')}"`);
  });

  it('renders the unsupported state disabled with the reason', () => {
    const html = render({ initialVoiceState: 'unsupported' });
    const button = html.match(new RegExp(`<button[^>]*aria-label="${t('composer.recordUnsupported')}"[^>]*>`))?.[0] ?? '';

    expect(button).toContain('disabled=""');
    expect(textOf(html)).toContain(t('composer.recordUnsupported'));
  });

  it('shows the recording state with elapsed time, stop and cancel', () => {
    const text = textOf(render({ initialVoiceState: 'recording', initialRecordingSeconds: 7 }));

    expect(text).toContain(t('composer.recording', { duration: '0:07' }));
    expect(text).toContain(t('composer.recordStop'));
    expect(text).toContain(t('composer.recordCancel'));
  });
});
