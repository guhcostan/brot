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
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

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
