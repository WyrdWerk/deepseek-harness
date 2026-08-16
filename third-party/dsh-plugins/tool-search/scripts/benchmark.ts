/** Print the deterministic dsh-tool-search keyless benchmark. */

import {
  formatToolSearchBenchmarkMarkdown,
  runToolSearchBenchmark,
} from '../tests/benchmark.ts'

const result = await runToolSearchBenchmark()
if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
else process.stdout.write(formatToolSearchBenchmarkMarkdown(result))
