import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  HandoffDatabase,
  HandoffStatement,
} from "../../../service/handoff/relay";

/** Runs the relay's real SQL against SQLite, standing in for Cloudflare D1. */
export function localD1(): HandoffDatabase & { rows(): number } {
  const sqlite = new DatabaseSync(":memory:");
  const statement = (
    query: string,
    values: SQLInputValue[] = [],
  ): HandoffStatement => ({
    bind: (...next) => statement(query, next as SQLInputValue[]),
    run: async () => sqlite.prepare(query).run(...values),
    all: async <T>() => ({
      results: sqlite.prepare(query).all(...values) as T[],
    }),
  });
  return {
    prepare: (query) => statement(query),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        for (const next of statements) await next.run();
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    rows: () => {
      const table = sqlite
        .prepare(
          "SELECT count(*) AS n FROM sqlite_master WHERE name = 'handoff_chunks'",
        )
        .get() as { n: number };
      if (!table.n) return 0;
      return (
        sqlite.prepare("SELECT count(*) AS n FROM handoff_chunks").get() as {
          n: number;
        }
      ).n;
    },
  };
}
