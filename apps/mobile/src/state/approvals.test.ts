import { ApprovalKind } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { APPROVAL_KIND_LABELS, allowsAlways, needsBiometric, visibleArgs } from './approvals';

describe('approval rules', () => {
  it('labels every kind', () => {
    for (const kind of ApprovalKind.options) expect(APPROVAL_KIND_LABELS[kind]).toBeTruthy();
  });

  it('asks for biometrics only when allowing a sensitive action', () => {
    expect(needsBiometric('purchase', 'allow_once')).toBe(true);
    expect(needsBiometric('permission', 'allow_always')).toBe(true);
    expect(needsBiometric('purchase', 'deny')).toBe(false);
    expect(needsBiometric('shell', 'allow_once')).toBe(false);
  });

  it('withholds allow always for sensitive kinds', () => {
    expect(allowsAlways('send')).toBe(true);
    expect(allowsAlways('purchase')).toBe(false);
    expect(allowsAlways('delete')).toBe(false);
  });

  it('drops empty args', () => {
    expect(visibleArgs({ to: 'a@b.c', cc: '', bcc: null, body: 'hi' })).toEqual([
      ['to', 'a@b.c'],
      ['body', 'hi'],
    ]);
  });
});
