import type { Attachment } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { AudioAttachment } from './AudioAttachment';
import { MessageAttachments } from './MessageAttachments';

const at = '2026-10-19T09:00:00.000Z';
const audio: Attachment = {
  id: 'att_audio',
  name: 'voice-note-09-05-03.webm',
  mimeType: 'audio/webm',
  size: 12_345,
  kind: 'audio',
  createdAt: at,
};

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

describe('AudioAttachment', () => {
  it('renders a native audio player and a download link with name and size', () => {
    const html = renderToStaticMarkup(<AudioAttachment attachment={audio} />);
    const text = textOf(html);

    expect(html).toContain('<audio');
    expect(html).toContain('controls');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('/api/attachments/att_audio');
    expect(text).toContain(audio.name);
    expect(text).toContain('12 KB');
    expect(html).toContain(`aria-label="${t('attachment.play', { name: audio.name })}"`);
  });

  it('falls back to a file chip when the audio element fails', () => {
    const html = renderToStaticMarkup(<AudioAttachment attachment={audio} initialFailed />);
    expect(html).not.toContain('<audio');
    expect(textOf(html)).toContain(audio.name);
    expect(html).toContain('/api/attachments/att_audio');
  });
});

describe('MessageAttachments audio branch', () => {
  it('lists audio attachments under the voice-notes label', () => {
    const html = renderToStaticMarkup(<MessageAttachments attachments={[audio]} />);
    const text = textOf(html);

    expect(text).toContain(t('attachment.audio'));
    expect(html).toContain('<audio');
    expect(html).not.toContain(t('attachment.files'));
  });
});
