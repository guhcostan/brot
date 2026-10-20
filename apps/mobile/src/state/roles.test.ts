import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './roles';

describe('capabilitiesFor', () => {
  it('mirrors the server role rules', () => {
    expect(capabilitiesFor('full')).toEqual({ chat: true, approve: true, cancel: true, revokeSelf: true, takeover: true });
    expect(capabilitiesFor('approver')).toEqual({ chat: false, approve: true, cancel: false, revokeSelf: false, takeover: false });
    expect(capabilitiesFor('viewer')).toEqual({ chat: false, approve: false, cancel: false, revokeSelf: false, takeover: false });
  });
});
