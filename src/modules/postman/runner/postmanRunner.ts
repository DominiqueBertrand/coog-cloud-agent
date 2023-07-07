import newman, { NewmanRunSummary } from 'newman';

export class TestRunner {
  static testResult;
  static counter;

  static async newmanRunner(collect: object, env: object): Promise<NewmanRunSummary> {
    // run and return Promise newman test result
    return new Promise((resolve, reject) => {
      newman.run(
        {
          collection: collect,
          environment: env,
          reporters: 'cli',
        },
        (err, summary) => {
          if (err) {
            reject(err);
          } else {
            resolve(summary);
            //put summary of test in static testResult
            this.testResult = summary;
          }
        },
      );
    });
  }
}
