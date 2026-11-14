import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  CI_TRANSCRIPTS,
  EVAL_FIXTURES,
  PublishedSchema,
  readDocument,
  readSchema,
  repoRoot,
  SCHEMA_FILES,
  SchemaSet,
  TRANSCRIPT_FIXTURES,
} from '../__fixtures__/published-schemas.fixture';

type Json = Record<string, any>;

/** A directory laid out like `~/.heimdall`, to check real history against the schemas. */
const HOME_TO_CHECK = process.env['HEIMDALL_SCHEMA_CHECK_HOME'];
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const VALIDATOR = 'ajv';
const DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'];

const root = repoRoot();
const schemas = new SchemaSet();
const transcript = (name: string): Json =>
  readDocument(join(root, TRANSCRIPT_FIXTURES, name)) as Json;
const evalFile = (name: string): Json => readDocument(join(root, EVAL_FIXTURES, name)) as Json;
const ciTranscript = (name: string): Json => readDocument(join(root, CI_TRANSCRIPTS, name)) as Json;

function accepts(schema: PublishedSchema, value: unknown): void {
  const outcome = schemas.validate(schema, value);

  assert.ok(outcome.valid, `${outcome.path ?? ''} ${outcome.message ?? ''}`);
}

function refuses(schema: PublishedSchema, value: unknown, path: string, message?: RegExp): void {
  const outcome = schemas.validate(schema, value);

  assert.equal(outcome.valid, false);
  assert.equal(outcome.path, path);
  if (message !== undefined) {
    assert.match(outcome.message ?? '', message);
  }
}

/** A deep copy with one change, so a fixture is never edited in place. */
function changed<T>(value: T, change: (copy: T) => void): T {
  const copy = structuredClone(value);

  change(copy);
  return copy;
}

describe('The published schemas (ADR 0019, ADR 0021)', () => {
  describe('the schema files', () => {
    for (const schema of Object.values(PublishedSchema)) {
      it(`${SCHEMA_FILES[schema]} is draft 2020-12 and is named ${schema}`, () => {
        const document = readSchema(schema);

        assert.equal(document['$schema'], DRAFT);
        assert.equal(document['$id'], schema);
      });
    }

    it('compile once all four are registered', () => {
      for (const schema of Object.values(PublishedSchema)) {
        assert.equal(typeof schemas.compile(schema), 'function');
      }
    });

    it('refer to each other by id only: the transcript schema alone does not compile', () => {
      const alone = new SchemaSet([PublishedSchema.Transcript]);

      assert.throws(() => alone.compile(PublishedSchema.Transcript), /urn:heimdall:schema:report:v1/);
    });

    it('never refer to another file by path', () => {
      for (const schema of Object.values(PublishedSchema)) {
        const references = readFileSync(join(root, SCHEMA_FILES[schema]), 'utf8').matchAll(
          /"\$ref": "([^"]+)"/g,
        );

        for (const [, reference = ''] of references) {
          assert.match(reference, /^(#\/\$defs\/|urn:heimdall:schema:)/, reference);
        }
      }
    });
  });

  describe('transcripts', () => {
    const recorded = readdirSync(join(root, CI_TRANSCRIPTS)).filter((file) =>
      file.endsWith('.json'),
    );

    it('has the four CI transcripts to check', () => {
      assert.equal(recorded.length, 4);
    });

    for (const name of recorded) {
      it(`accepts the CI transcript ${name}, with a version 1 report and its run identity`, () => {
        const document = ciTranscript(name);

        assert.equal(document['outcome'].report.schemaVersion, 1);
        assert.equal(typeof document['meta'].runId, 'string');
        assert.equal(document['meta'].commit, null);
        accepts(PublishedSchema.Transcript, document);
        accepts(PublishedSchema.Report, document['outcome'].report);
      });
    }

    for (const name of recorded) {
      it(`${name}: every source call names a result of that run, of the kind its operation serves (ADR 0020)`, () => {
        const document = ciTranscript(name);
        const kinds = new Map(
          (document['outcome'].report.results as Json[]).map((result) => [
            result['result'] as string,
            result['kind'] as string,
          ]),
        );
        const serves: Record<string, readonly string[]> = {
          'metrics.queryRange': ['indicator'],
          'logs.queryRange': ['logs'],
          'traces.search': ['traces'],
          'traces.trace': ['traces', 'trace'],
        };

        assert.ok(document['telemetry'].length > 0);
        for (const exchange of document['telemetry'] as Json[]) {
          const [served, ...others] = (exchange['resultIds'] ?? []) as string[];

          assert.equal(others.length, 0);
          assert.ok(
            serves[exchange['operation'] as string]?.includes(kinds.get(served ?? '') ?? ''),
            `${exchange['operation'] as string} served ${served ?? 'nothing'}`,
          );
        }
      });
    }

    it('accepts a run recorded before the link: no source call names a result', () => {
      const document = transcript('report-before-v1.json');

      assert.ok(document['telemetry'].length > 0);
      assert.ok((document['telemetry'] as Json[]).every((exchange) => !('resultIds' in exchange)));
      accepts(PublishedSchema.Transcript, document);
    });

    it('accepts a run whose report was recorded before schemaVersion', () => {
      const document = transcript('report-before-v1.json');
      const report = document['outcome'].report as Json;

      for (const absent of ['schemaVersion', 'keyFigures', 'blindSpots', 'impact', 'profiles']) {
        assert.equal(absent in report, false, absent);
      }
      accepts(PublishedSchema.Transcript, document);
    });

    it('accepts a failed run: an error and no report', () => {
      const document = transcript('failed-run.json');

      assert.equal(typeof document['outcome'].error.errorCode, 'string');
      assert.equal('report' in document['outcome'], false);
      accepts(PublishedSchema.Transcript, document);
    });

    it('accepts a plan-only run: a plan and no report', () => {
      const document = transcript('plan-only.json');

      assert.equal(document['meta'].command.planOnly, true);
      assert.equal(typeof document['outcome'].plan, 'object');
      assert.equal('report' in document['outcome'], false);
      accepts(PublishedSchema.Transcript, document);
    });

    it('covers every result kind and every event type the fixtures hold', () => {
      const documents = [
        ...recorded.map(ciTranscript),
        transcript('report-before-v1.json'),
        transcript('plan-only.json'),
      ];
      const events = new Set(
        documents.flatMap((document) =>
          (document['outcome'].events as Json[]).map((event) => event['type'] as string),
        ),
      );
      const kinds = new Set(
        documents.flatMap((document) =>
          ((document['outcome'].report?.results ?? []) as Json[]).map(
            (result) => result['kind'] as string,
          ),
        ),
      );

      assert.deepEqual([...events].sort(), [
        'investigation.agent_turn',
        'investigation.check_completed',
        'investigation.entry_located',
        'investigation.plan_ready',
        'investigation.scope_resolved',
        'investigation.started',
        'investigation.symptom_classified',
      ]);
      assert.deepEqual([...kinds].sort(), ['indicator', 'logs', 'traces']);
    });

    it('refuses a renamed required field, naming where', () => {
      const broken = changed(transcript('failed-run.json'), (copy) => {
        copy['meta'].recorded = copy['meta'].recordedAt;
        delete copy['meta'].recordedAt;
      });

      refuses(PublishedSchema.Transcript, broken, '/meta', /recordedAt/);
    });

    it('refuses another transcript version', () => {
      const broken = changed(transcript('failed-run.json'), (copy) => {
        copy['version'] = 2;
      });

      refuses(PublishedSchema.Transcript, broken, '/version');
    });

    it('refuses an event of an unknown type', () => {
      const broken = changed(transcript('failed-run.json'), (copy) => {
        copy['outcome'].events.push({ type: 'investigation.unheard_of' });
      });
      const outcome = schemas.validate(PublishedSchema.Transcript, broken);

      assert.equal(outcome.valid, false);
      assert.match(outcome.path ?? '', /^\/outcome\/events\/\d+/);
    });

    it('refuses an event that lost a field of its type', () => {
      const broken = changed(transcript('plan-only.json'), (copy) => {
        const located = (copy['outcome'].events as Json[]).find(
          (event) => event['type'] === 'investigation.entry_located',
        );

        delete located?.['entry'].vertex;
      });

      assert.equal(schemas.validate(PublishedSchema.Transcript, broken).valid, false);
    });

    it('refuses a result of an unknown kind, and one that lost its verdict', () => {
      const document = ciTranscript('error-burst-30s.json');
      const indicator = (document['outcome'].report.results as Json[]).findIndex(
        (result) => result['kind'] === 'indicator',
      );
      const unknownKind = changed(document, (copy) => {
        copy['outcome'].report.results[indicator].kind = 'profile';
      });
      const noVerdict = changed(document, (copy) => {
        delete copy['outcome'].report.results[indicator].verdict;
      });

      assert.equal(schemas.validate(PublishedSchema.Transcript, unknownKind).valid, false);
      assert.equal(schemas.validate(PublishedSchema.Transcript, noVerdict).valid, false);
    });

    it('refuses a report of another schema version, and a version 1 report without its sections', () => {
      const report = ciTranscript('error-burst-30s.json')['outcome'].report as Json;

      refuses(
        PublishedSchema.Report,
        changed(report, (copy) => {
          copy['schemaVersion'] = 2;
        }),
        '/schemaVersion',
      );
      assert.equal(
        schemas.validate(
          PublishedSchema.Report,
          changed(report, (copy) => {
            delete copy['keyFigures'];
          }),
        ).valid,
        false,
      );
    });

    it('accepts the shapes no recording holds yet: a single-trace result and a run without a conclusion', () => {
      const withExemplar = (result: Json): boolean =>
        result['kind'] === 'traces' && result['exemplar'] !== null;
      const document =
        recorded
          .map(ciTranscript)
          .find((candidate) => (candidate['outcome'].report.results as Json[]).some(withExemplar)) ??
        {};
      const traces = ((document['outcome']?.report.results ?? []) as Json[]).find(withExemplar);

      assert.notEqual(traces, undefined, 'no CI transcript holds a traces result with an exemplar');
      const fetched = changed(document, (copy) => {
        copy['outcome'].report.results.push({
          result: 'r999',
          check: null,
          subject: traces?.['subject'],
          redaction: traces?.['redaction'],
          problem: null,
          kind: 'trace',
          trace: traces?.['exemplar'],
        });
      });
      const inconclusive = changed(document, (copy) => {
        delete copy['outcome'].report.conclusion;
        copy['outcome'].report.outcome = 'inconclusive';
        copy['outcome'].report.agentReason = 'no-stop-call';
        copy['outcome'].report.traceId = '48e635fc186d39159afa4d12bea2e72f';
      });

      accepts(PublishedSchema.Transcript, fetched);
      accepts(PublishedSchema.Transcript, inconclusive);
      assert.equal(
        schemas.validate(
          PublishedSchema.Transcript,
          changed(inconclusive, (copy) => {
            copy['outcome'].report.agentReason = 'gave-up';
          }),
        ).valid,
        false,
      );
    });

    it('accepts unknown properties at every level', () => {
      const widened = changed(ciTranscript('error-burst-30s.json'), (copy) => {
        copy['later'] = true;
        copy['meta'].later = true;
        copy['meta'].command.later = true;
        copy['telemetry'][0].later = true;
        copy['model'][0].later = true;
        copy['outcome'].later = true;
        copy['outcome'].events[0].later = true;
        copy['outcome'].report.later = true;
        copy['outcome'].report.plan.later = true;
        copy['outcome'].report.plan.checks[0].later = true;
        copy['outcome'].report.results[0].later = true;
        copy['outcome'].report.conclusion.later = true;
        copy['outcome'].report.usage.later = true;
      });

      accepts(PublishedSchema.Transcript, widened);
    });

    it('accepts a number JSON cannot hold as it is written, and nothing else in its place', () => {
      const document = ciTranscript('error-burst-30s.json');
      const peaked = (document['outcome'].report.results as Json[]).findIndex(
        (result) => result['kind'] === 'indicator' && result['peak'] !== null,
      );
      const encoded = (text: string): Json =>
        changed(document, (copy) => {
          copy['outcome'].report.results[peaked].peak.z = { $number: text };
        });

      assert.notEqual(peaked, -1);
      for (const written of ['NaN', 'Infinity', '-Infinity']) {
        accepts(PublishedSchema.Transcript, encoded(written));
      }
      assert.equal(schemas.validate(PublishedSchema.Transcript, encoded('12')).valid, false);
    });

    it('accepts the identity and link fields, and keeps them optional', () => {
      const document = changed(ciTranscript('error-burst-30s.json'), (copy) => {
        delete copy['meta'].runId;
        delete copy['meta'].commit;
      });
      const result = document['outcome'].report.results[0].result as string;
      const identified = changed(document, (copy) => {
        copy['meta'].runId = '0f3c9a52-6d0e-4a1b-9c1d-3b7e2f4a8c10';
        copy['meta'].commit = '2e3ef8e0c1d2b3a4f5e6d7c8b9a0f1e2d3c4b5a6';
        copy['meta'].dirty = true;
        copy['telemetry'][0].resultIds = [result];
      });
      const outsideCheckout = changed(document, (copy) => {
        copy['meta'].commit = null;
      });
      const wrongCommit = changed(document, (copy) => {
        copy['meta'].commit = 12;
      });
      const emptyLink = changed(document, (copy) => {
        copy['telemetry'][0].resultIds = [];
      });

      assert.equal('runId' in document['meta'], false);
      accepts(PublishedSchema.Transcript, identified);
      accepts(PublishedSchema.Transcript, outsideCheckout);
      refuses(PublishedSchema.Transcript, wrongCommit, '/meta/commit');
      refuses(PublishedSchema.Transcript, emptyLink, '/telemetry/0/resultIds');
    });
  });

  describe('scorecards', () => {
    it('accepts a session that wrote tokens.agent', () => {
      const document = evalFile('scorecard-tokens-agent.json');

      assert.equal('agent' in document['runs'][0].tokens, true);
      assert.equal('version' in document, false);
      accepts(PublishedSchema.Scorecard, document);
    });

    it('accepts a session that wrote tokens.investigation', () => {
      const document = evalFile('scorecard-tokens-investigation.json');

      assert.equal('investigation' in document['runs'][0].tokens, true);
      accepts(PublishedSchema.Scorecard, document);
    });

    it('accepts a session whose only run failed: no outcome, scores or sheet', () => {
      const document = evalFile('scorecard-failed-run.json');

      assert.equal(document['runs'][0].scores, null);
      accepts(PublishedSchema.Scorecard, document);
    });

    it('accepts a calibrated judge with its lock, and refuses a lock that lost a field', () => {
      const document = evalFile('scorecard-calibrated.json');

      assert.equal(document['judge'].lock.passed, true);
      accepts(PublishedSchema.Scorecard, document);
      refuses(
        PublishedSchema.Scorecard,
        changed(document, (copy) => {
          delete copy['judge'].lock.agreement;
        }),
        '/judge/lock',
        /agreement/,
      );
    });

    it('accepts the version and build identity that a later slice writes', () => {
      const identified = changed(evalFile('scorecard-tokens-investigation.json'), (copy) => {
        copy['version'] = 1;
        copy['heimdall'] = { version: '0.0.0', commit: null };
      });

      accepts(PublishedSchema.Scorecard, identified);
      refuses(
        PublishedSchema.Scorecard,
        changed(identified, (copy) => {
          copy['version'] = 2;
        }),
        '/version',
      );
    });

    it('refuses a run with neither token shape, and one with a score out of range', () => {
      const document = evalFile('scorecard-tokens-investigation.json');
      const noTokens = changed(document, (copy) => {
        delete copy['runs'][0].tokens.investigation;
      });
      const outOfRange = changed(document, (copy) => {
        copy['runs'][0].scores.component.score = 3;
      });

      assert.equal(schemas.validate(PublishedSchema.Scorecard, noTokens).valid, false);
      assert.equal(schemas.validate(PublishedSchema.Scorecard, outOfRange).valid, false);
    });
  });

  describe('scoring sheets', () => {
    it('accepts a sheet parsed from its YAML, blank and hand-scored', () => {
      const document = evalFile('error-burst-30s-1.score.yaml');
      const scored = changed(document, (copy) => {
        copy['human'] = { component: 2, mechanism: 1, evidence: 0 };
        copy['note'] = 'the mechanism misses the retry storm';
        copy['version'] = 1;
      });

      assert.equal(document['human'].component, null);
      accepts(PublishedSchema.ScoringSheet, document);
      accepts(PublishedSchema.ScoringSheet, scored);
    });

    it('refuses a hand score out of range, and a sheet without what the judge saw', () => {
      const document = evalFile('error-burst-30s-1.score.yaml');

      refuses(
        PublishedSchema.ScoringSheet,
        changed(document, (copy) => {
          copy['human'].evidence = 3;
        }),
        '/human/evidence',
      );
      refuses(
        PublishedSchema.ScoringSheet,
        changed(document, (copy) => {
          delete copy['judgeInput'];
        }),
        '',
        /judgeInput/,
      );
    });
  });

  describe('the validator', () => {
    it('is an exact-pinned dev dependency of the repository, and a dependency of nothing', () => {
      const manifest = (file: string): Json => JSON.parse(readFileSync(file, 'utf8')) as Json;
      const workspaces = ['libs', 'apps'].flatMap((group) =>
        readdirSync(join(root, group))
          .map((name) => join(root, group, name, 'package.json'))
          .filter((file) => existsSync(file)),
      );

      assert.match(manifest(join(root, 'package.json'))['devDependencies'][VALIDATOR], /^\d+\.\d+\.\d+$/);
      for (const file of [join(root, 'package.json'), ...workspaces]) {
        for (const field of DEPENDENCY_FIELDS) {
          assert.equal(VALIDATOR in (manifest(file)[field] ?? {}), false, `${file} ${field}`);
        }
      }
    });
  });

  describe('real history', () => {
    it(
      'validates every file under HEIMDALL_SCHEMA_CHECK_HOME',
      { skip: HOME_TO_CHECK === undefined ? 'HEIMDALL_SCHEMA_CHECK_HOME is not set' : false },
      () => {
        const { checked, invalid } = schemas.validateHome(HOME_TO_CHECK ?? '');

        assert.ok(checked > 0, 'nothing to check');
        assert.deepEqual(invalid, []);
      },
    );
  });
});
