import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import type { ApprovalStatus } from '@brot/protocol';
import { ApprovalStatusBadge, APPROVAL_STATUS_KEY, APPROVAL_STATUS_TONE } from './approvalStatus';

const STATUSES: readonly ApprovalStatus[] = ['pending', 'allowed', 'denied', 'expired'];

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

describe('approval status labels and tones', () => {
  it('covers every status with a label and a tone', () => {
    expect(Object.keys(APPROVAL_STATUS_KEY).sort()).toEqual([...STATUSES].sort());
    expect(Object.keys(APPROVAL_STATUS_TONE).sort()).toEqual([...STATUSES].sort());
    expect(t(APPROVAL_STATUS_KEY.expired)).toBe('Expired');
    expect(t(APPROVAL_STATUS_KEY.pending)).toBe('Pending');
    expect(t(APPROVAL_STATUS_KEY.allowed)).toBe('Allowed');
    expect(t(APPROVAL_STATUS_KEY.denied)).toBe('Denied');
  });

  it('gives expired a muted tone distinct from denied', () => {
    expect(APPROVAL_STATUS_TONE.denied).toBe('attention');
    expect(APPROVAL_STATUS_TONE.expired).toBe('neutral');
    expect(APPROVAL_STATUS_TONE.expired).not.toBe(APPROVAL_STATUS_TONE.denied);
  });

  it('renders the expired label without the attention tone', () => {
    const html = renderToStaticMarkup(<ApprovalStatusBadge status="expired" />);

    expect(textOf(html)).toContain('Expired');
    expect(html).not.toContain('data-tone="attention"');
  });

  it('keeps denied in the attention tone', () => {
    const html = renderToStaticMarkup(<ApprovalStatusBadge status="denied" />);

    expect(textOf(html)).toContain('Denied');
    expect(html).toContain('data-tone="attention"');
  });
});
