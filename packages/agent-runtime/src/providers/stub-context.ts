import type { ContextProvider } from '../interfaces.js'

// Demo-phase context provider: returns hardcoded JSON spec from fixtures.
// Replace with PgVectorContextProvider when ingestion is wired.
export class StubContextProvider implements ContextProvider {
  constructor(private specJson: string) {}

  async search(_intent: string, _platformId: string): Promise<string> {
    return this.specJson
  }
}
