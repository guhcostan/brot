/** A request breaks a team rule (depth, chain size, room size, ended task). The API answers 409. */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}
