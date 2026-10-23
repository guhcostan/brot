import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_BOTS } from '../data/fixtures';
import { t } from '../i18n';
import { NewRoomDialog } from './NewRoomDialog';

const noopAsync = async () => undefined;
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(): string {
  return renderToStaticMarkup(<NewRoomDialog open bots={DEMO_BOTS.slice(0, 3)} onClose={() => undefined} onCreate={noopAsync} />);
}

describe('NewRoomDialog responder modes', () => {
  it('offers lead, mention and the auto decider option with its hint', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('newRoom.modeLead'));
    expect(text).toContain(t('newRoom.modeLeadHint'));
    expect(text).toContain(t('newRoom.modeMention'));
    expect(text).toContain(t('newRoom.modeMentionHint'));
    expect(text).toContain(t('newRoom.modeAuto'));
    expect(text).toContain(t('newRoom.modeAutoHint'));
    expect(html).toContain('value="auto"');
    expect(html.match(/name="responder"/g)).toHaveLength(3);
  });
});
